const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const usernameInput = document.getElementById('usernameInput');
const roomInput = document.getElementById('roomInput');

// New DOM elements for the redesigned UI
const landingPage = document.getElementById('landingPage');
const chatRoom = document.getElementById('chatRoom');
const joinRoomButton = document.getElementById('joinRoomButton');
const leaveRoomButton = document.getElementById('leaveRoomButton');
const currentRoomDisplay = document.getElementById('currentRoomDisplay');
const currentUserDisplay = document.getElementById('currentUserDisplay');
const memberList = document.getElementById('memberList');
const roomTags = document.querySelectorAll('.room-tag');

let ws = null;
let currentRoom = '';
let currentUsername = '';
let members = new Set();

function appendMessage(msg) {
    const messageBubble = document.createElement('div');
    messageBubble.classList.add('message-bubble');

    let content = '';
    let timestampHtml = '';

    if (msg.ts) {
        const date = new Date(msg.ts * 1000);
        timestampHtml = `<div class="message-timestamp">${date.toLocaleTimeString()}</div>`;
    }

    if (msg.type === 'message') {
        content = `<strong>${msg.user}:</strong> ${msg.message}`;
        messageBubble.classList.add(msg.user === currentUsername ? 'sent' : 'received');
    } else if (msg.type === 'join') {
        content = `<em>${msg.user} has joined the room.</em>`;
        messageBubble.classList.add('system-message');
        if (msg.user !== "System") {
            addMember(msg.user);
        }
    } else if (msg.type === 'leave') {
        content = `<em>${msg.user} has left the room.</em>`;
        messageBubble.classList.add('system-message');
        if (msg.user !== "System") {
            removeMember(msg.user);
        }
    }

    messageBubble.innerHTML = content + timestampHtml;
    messagesDiv.appendChild(messageBubble);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updateMemberList() {
    memberList.innerHTML = '';
    const sortedMembers = Array.from(members).sort((a, b) => {
        if (a === currentUsername) return -1;
        if (b === currentUsername) return 1;
        return a.localeCompare(b);
    });

    sortedMembers.forEach(member => {
        const listItem = document.createElement('li');
        const statusIcon = '<i class="fas fa-circle online-status"></i> ';
        const userText = member === currentUsername ? `${member} (you)` : member;
        listItem.innerHTML = statusIcon + userText;
        memberList.appendChild(listItem);
    });
}

function addMember(username) {
    members.add(username);
    updateMemberList();
}

function removeMember(username) {
    members.delete(username);
    updateMemberList();
}

function displayChatRoom() {
    landingPage.style.display = 'none';
    chatRoom.style.display = 'flex';
    messageInput.disabled = false;
    sendButton.disabled = false;
    messageInput.focus();
}

function displayLandingPage() {
    landingPage.style.display = 'flex';
    chatRoom.style.display = 'none';
    messageInput.disabled = true;
    sendButton.disabled = true;
    // Clear inputs and member list when returning to landing page
    usernameInput.value = '';
    roomInput.value = '';
    messagesDiv.innerHTML = '';
    memberList.innerHTML = '';
    members.clear();
}

function connectToRoom() {
    currentUsername = usernameInput.value.trim();
    currentRoom = roomInput.value.trim();

    if (!currentUsername) {
        alert('Please enter your username.');
        usernameInput.focus();
        return;
    }

    if (!currentRoom) {
        alert('Please enter a room name.');
        roomInput.focus();
        return;
    }

    // Prevent multiple connections
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }

    // Construct WebSocket URL dynamically based on the current host
    const ws_protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws_url = `${ws_protocol}//${window.location.host}/ws/chat/${currentRoom}?username=${currentUsername}`;

    ws = new WebSocket(ws_url);

    ws.onopen = (event) => {
        appendMessage({ type: 'join', user: 'System', message: 'Connected to chat.', ts: Date.now() / 1000 });
        displayChatRoom();
        currentRoomDisplay.textContent = `#${currentRoom}`;
        currentUserDisplay.textContent = `${currentUsername} (you)`;
        messageInput.placeholder = `Message #${currentRoom}...`;
        members.clear();
        // The backend sends a 'join' message for the current user, which will add them to the list.
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        appendMessage(data);
    };

    ws.onclose = (event) => {
        appendMessage({ type: 'leave', user: 'System', message: 'Disconnected from chat.', ts: Date.now() / 1000 });
        ws = null;
        displayLandingPage();
    };

    ws.onerror = (event) => {
        console.error("WebSocket error:", event);
        appendMessage({ type: 'leave', user: 'System', message: 'WebSocket connection failed. Please try again.', ts: Date.now() / 1000 });
        if (ws) ws.close();
        else displayLandingPage();
        alert("Could not connect to the chat room. Please ensure the server is running and try again.");
    };
}

function disconnectFromRoom() {
    if (ws) {
        ws.close();
    }
}

sendButton.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = messageInput.value;
        if (message.trim() !== '') {
            ws.send(message);
            messageInput.value = '';
        }
    }
});

messageInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        sendButton.click();
    }
});

joinRoomButton.addEventListener('click', connectToRoom);
leaveRoomButton.addEventListener('click', disconnectFromRoom);

roomTags.forEach(tag => {
    tag.addEventListener('click', () => {
        roomInput.value = tag.dataset.room;
        // If username is already entered, attempt to connect directly
        if (usernameInput.value.trim() !== '') {
            connectToRoom();
        } else {
            // Otherwise, focus on username input for user to type
            usernameInput.focus();
        }
    });
});

// Add event listener for enter key on username and room input fields
usernameInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        if (roomInput.value.trim() !== '') {
            connectToRoom();
        } else {
            roomInput.focus();
        }
    }
});

roomInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        connectToRoom();
    }
});

// Initial display on page load
displayLandingPage();
