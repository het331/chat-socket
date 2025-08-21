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
        self._lock = asyncio.Lock()

    async def connect(self, room: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            if room not in self.room_to_clients:
                self.room_to_clients[room] = set()
            self.room_to_clients[room].add(websocket)

    async def disconnect(self, room: str, websocket: WebSocket) -> None:
        async with self._lock:
            clients = self.room_to_clients.get(room)
            if clients and websocket in clients:
                clients.remove(websocket)
                if not clients:
                    del self.room_to_clients[room]

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
async def chat_websocket(websocket: WebSocket, room: str, username: str = Query(default="anonymous")):
    await manager.connect(room, websocket)
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


