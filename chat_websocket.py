import asyncio
import time
import os
from typing import Dict, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import uvicorn


app = FastAPI(title="Chat WebSocket Service", version="1.0.0")

# Construct the absolute path to the static directory
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
async def get_root():
    with open(os.path.join(STATIC_DIR, "index.html"), "r") as f:
        html_content = f.read()
    return HTMLResponse(content=html_content, status_code=200)


class RoomConnectionManager:
    """Manages WebSocket connections grouped by room."""

    def __init__(self) -> None:
        self.room_to_clients: Dict[str, Set[WebSocket]] = {}
        self.room_passwords: Dict[str, str] = {}
        self.room_owner: Dict[str, str] = {}
        self.websocket_to_username: Dict[WebSocket, str] = {}
        self.websocket_to_room: Dict[WebSocket, str] = {}
        self._lock = asyncio.Lock()

    async def verify_password(self, room: str, provided_password: str, username: str) -> bool:
        """Verify or set the room password.

        - If the room has no clients and no stored password, set the provided password.
        - If the room already has a password, ensure the provided one matches.
        """
        async with self._lock:
            has_clients = bool(self.room_to_clients.get(room))
            if not has_clients and room not in self.room_passwords:
                # First creator of the room: must provide a non-empty password
                if provided_password and provided_password.strip():
                    self.room_passwords[room] = provided_password
                    self.room_owner[room] = username
                    return True
                # Empty password is not allowed for new room creation
                return False

            expected = self.room_passwords.get(room)
            return expected is not None and provided_password == expected

    async def connect(self, room: str, websocket: WebSocket, username: str) -> None:
        await websocket.accept()
        async with self._lock:
            if room not in self.room_to_clients:
                self.room_to_clients[room] = set()
            self.room_to_clients[room].add(websocket)
            self.websocket_to_username[websocket] = username
            self.websocket_to_room[websocket] = room

    async def disconnect(self, room: str, websocket: WebSocket) -> None:
        other_clients: Set[WebSocket] = set()
        owner_left = False
        async with self._lock:
            leaving_username = self.websocket_to_username.pop(websocket, None)
            self.websocket_to_room.pop(websocket, None)

            clients = self.room_to_clients.get(room)
            if clients and websocket in clients:
                clients.remove(websocket)

            if clients:
                # If owner left while others remain, mark to close the room
                if leaving_username and self.room_owner.get(room) == leaving_username:
                    owner_left = True
                    other_clients = set(clients)
            
            if not clients or owner_left:
                # Cleanup room metadata now or after kicking others
                self.room_to_clients.pop(room, None)
                self.room_passwords.pop(room, None)
                self.room_owner.pop(room, None)

        if owner_left and other_clients:
            # Close all other client connections with an app-defined code
            for client in other_clients:
                try:
                    await client.close(code=4001, reason="Room closed by owner")
                except Exception:
                    pass
            # Remove mappings for the kicked clients
            async with self._lock:
                for client in other_clients:
                    self.websocket_to_username.pop(client, None)
                    self.websocket_to_room.pop(client, None)

    async def broadcast(self, room: str, data: dict) -> None:
        async with self._lock:
            clients = list(self.room_to_clients.get(room, set()))
        to_remove: Set[WebSocket] = set()
        for client in clients:
            try:
                await client.send_json(data)
            except Exception:
                to_remove.add(client)
        if to_remove:
            async with self._lock:
                for client in to_remove:
                    if room in self.room_to_clients and client in self.room_to_clients[room]:
                        self.room_to_clients[room].remove(client)
                if room in self.room_to_clients and not self.room_to_clients[room]:
                    del self.room_to_clients[room]


manager = RoomConnectionManager()


@app.websocket("/ws/chat/{room}")
async def chat_websocket(
    websocket: WebSocket,
    room: str,
    username: str = Query(default="anonymous"),
    password: str = Query(default="", description="Room password"),
):
    # Validate or set the room password before accepting messages/broadcasts
    is_valid = await manager.verify_password(room, password, username)
    if not is_valid:
        # Reject the connection with a policy violation code and a short message
        # Note: WebSocket close reason text may not always be surfaced to clients
        await websocket.close(code=1008, reason="Invalid room password")
        return

    await manager.connect(room, websocket, username)
    try:
        join_event = {"type": "join", "room": room, "user": username, "ts": time.time()}
        await manager.broadcast(room, join_event)
        while True:
            text = await websocket.receive_text()
            message_event = {
                "type": "message",
                "room": room,
                "user": username,
                "message": text,
                "ts": time.time(),
            }
            await manager.broadcast(room, message_event)
    except WebSocketDisconnect:
        await manager.disconnect(room, websocket)
        leave_event = {"type": "leave", "room": room, "user": username, "ts": time.time()}
        await manager.broadcast(room, leave_event)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8010, reload=False)


