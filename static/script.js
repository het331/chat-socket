const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const emojiToggle = document.getElementById('emojiToggle');
const emojiPanel = document.getElementById('emojiPanel');
const scrollBottomBtn = document.getElementById('scrollBottom');
const dingSound = document.getElementById('dingSound');
const usernameInput = document.getElementById('usernameInput');
const roomInput = document.getElementById('roomInput');
const roomPasswordInput = document.getElementById('roomPasswordInput'); // New

// New DOM elements for the redesigned UI
const landingPage = document.getElementById('landingPage');
const chatRoom = document.getElementById('chatRoom');
const joinRoomButton = document.getElementById('joinRoomButton');
const leaveRoomButton = document.getElementById('leaveRoomButton');
const currentRoomDisplay = document.getElementById('currentRoomDisplay');
const currentUserDisplay = document.getElementById('currentUserDisplay');
const memberList = document.getElementById('memberList');
const roomTags = document.querySelectorAll('.room-tag');
const toastContainer = document.getElementById('toastContainer');
const ENABLE_TOASTS = false;
const typingIndicator = document.getElementById('typingIndicator');
const sidebarToggle = document.getElementById('sidebarToggle');

let ws = null;
let currentRoom = '';
let currentUsername = '';
let members = new Set();

function linkify(text) {
    const urlRegex = /(https?:\/\/[\w.-]+(?:\/[\w\-._~:/?#[\]@!$&'()*+,;=.]+)?)/g;
    return text.replace(urlRegex, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
}

function appendMessage(msg) {
    const row = document.createElement('div');
    const messageBubble = document.createElement('div');
    messageBubble.classList.add('message-bubble');

    let content = '';
    let timestampHtml = '';

    if (msg.ts) {
        const date = new Date(msg.ts * 1000);
        timestampHtml = `<div class="message-timestamp">${date.toLocaleTimeString()}</div>`;
    }

    if (msg.type === 'message') {
        const safeMessage = linkify(msg.message || '');
        content = `<strong>${msg.user}:</strong> ${safeMessage}`;
        const isMe = msg.user === currentUsername;
        messageBubble.classList.add(isMe ? 'sent' : 'received');
        row.className = `message-row ${isMe ? 'sent' : 'received'}`;
        if (!isMe) {
            const initial = (msg.user || '?').trim().charAt(0).toUpperCase();
            const avatar = document.createElement('div');
            avatar.className = 'avatar';
            avatar.textContent = initial || '?';
            row.appendChild(avatar);
        }
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

    // Add copy action
    if (msg.type === 'message') {
        const actions = document.createElement('div');
        actions.className = 'message-actions';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'icon-button';
        copyBtn.title = 'Copy';
        copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(msg.message || '').then(() => {
                showToast('Message copied', 'success');
            });
        });
        actions.appendChild(copyBtn);
        messageBubble.appendChild(actions);
    }
    if (row.className) {
        row.appendChild(messageBubble);
        messagesDiv.appendChild(row);
    } else {
        messagesDiv.appendChild(messageBubble);
    }
    // Always auto-scroll to the latest message (robust scheduling)
    scheduleScrollToBottom();
    // Play sound for messages from others
    if (dingSound && msg.type === 'message' && msg.user !== currentUsername) {
        try { dingSound.currentTime = 0; dingSound.play(); } catch(e) {}
    }
}

function showToast(message, type = 'info', timeoutMs = 3000) {
    if (!ENABLE_TOASTS || !toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, timeoutMs);
}

function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    const newHeight = Math.min(messageInput.scrollHeight, 140);
    messageInput.style.height = `${newHeight}px`;
}

function ensureScrolledToBottom(force = false) {
    const threshold = 48; // px tolerance to treat as "at bottom"
    const atBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight <= threshold;
    if (force || atBottom) {
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        if (scrollBottomBtn) scrollBottomBtn.style.display = 'none';
    } else {
        if (scrollBottomBtn) scrollBottomBtn.style.display = 'block';
    }
}

// Schedule scroll to bottom after DOM/layout flushes to make it very reliable
function scheduleScrollToBottom() {
    requestAnimationFrame(() => {
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        requestAnimationFrame(() => {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        });
        setTimeout(() => {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }, 50);
    });
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
        listItem.className = 'flex items-center gap-2 py-1';
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = (member || '?').trim().charAt(0).toUpperCase();
        const label = document.createElement('span');
        label.textContent = member === currentUsername ? `${member} (you)` : member;
        listItem.appendChild(avatar);
        listItem.appendChild(label);
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
    if (emojiToggle) emojiToggle.disabled = false;
    if (sidebarToggle) sidebarToggle.style.display = window.innerWidth <= 768 ? 'inline-flex' : 'none';
    messageInput.focus();
    // Ensure input stays visible and scrolled to bottom on open
    ensureScrolledToBottom(true);
}

function displayLandingPage() {
    landingPage.style.display = 'flex';
    chatRoom.style.display = 'none';
    messageInput.disabled = true;
    sendButton.disabled = true;
    // Clear inputs and member list when returning to landing page
    usernameInput.value = '';
    roomInput.value = '';
    roomPasswordInput.value = ''; // Clear room password
    messagesDiv.innerHTML = '';
    memberList.innerHTML = '';
    members.clear();
}

// Show landing but preserve username/room so user can correct password
function showPasswordRetry() {
    landingPage.style.display = 'flex';
    chatRoom.style.display = 'none';
    messageInput.disabled = true;
    sendButton.disabled = true;
    roomPasswordInput.value = '';
    roomPasswordInput.focus();
}

function connectToRoom() {
    currentUsername = usernameInput.value.trim();
    currentRoom = roomInput.value.trim();
    const roomPassword = roomPasswordInput.value.trim();

    if (!currentUsername) {
        alert('Please enter your username.');
        showToast('Please enter your username.', 'error');
        usernameInput.focus();
        return;
    }

    if (!currentRoom) {
        alert('Please enter a room name.');
        showToast('Please enter a room name.', 'error');
        roomInput.focus();
        return;
    }

    // Require password for room creation/join
    if (!roomPassword) {
        alert('Enter correct room password');
        showToast('Enter correct room password', 'error');
        roomPasswordInput.focus();
        return;
    }

    // Clear previous messages and members before establishing a new connection
    messagesDiv.innerHTML = '';
    memberList.innerHTML = '';
    members.clear();

    // Prevent multiple connections: Close any existing WebSocket connection
    if (ws && ws.readyState !== WebSocket.CLOSED) {
        ws.close();
    }

    // Construct WebSocket URL dynamically based on the current host
    const ws_protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws_url = `${ws_protocol}//${window.location.host}/ws/chat/${currentRoom}?username=${currentUsername}`;
    if (roomPassword) {
        ws_url += `&password=${encodeURIComponent(roomPassword)}`;
    }

    ws = new WebSocket(ws_url);

    ws.onopen = (event) => {
        appendMessage({ type: 'join', user: 'System', message: 'Connected to chat.', ts: Date.now() / 1000 });
        showToast(`Joined #${currentRoom} as ${currentUsername}`, 'success');
        displayChatRoom();
        currentRoomDisplay.textContent = `#${currentRoom}`;
        currentUserDisplay.textContent = `${currentUsername} (you)`;
        messageInput.placeholder = `Message #${currentRoom}...`;
        // Members will be added as join messages are received from the server
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        // Hide typing indicator on any message
        if (typingIndicator) typingIndicator.style.display = 'none';
        appendMessage(data);
    };

    ws.onclose = (event) => {
        // Handle invalid password explicitly (policy violation)
        if (event.code === 1008) {
            const reason = event.reason || 'Enter correct room password';
            appendMessage({ type: 'leave', user: 'System', message: reason, ts: Date.now() / 1000 });
            alert(reason);
            showToast(reason, 'error');
            ws = null;
            showPasswordRetry();
            return;
        } else if (event.code === 4001) {
            const reason = event.reason || 'Room closed by owner';
            appendMessage({ type: 'leave', user: 'System', message: reason, ts: Date.now() / 1000 });
            alert(reason);
            showToast(reason, 'info');
        } else if (event.code !== 1006) { // 1006 often paired with ws.onerror
            appendMessage({ type: 'leave', user: 'System', message: 'Disconnected from chat.', ts: Date.now() / 1000 });
            showToast('Disconnected from chat', 'info');
        }
        ws = null;
        displayLandingPage();
    };

    ws.onerror = (event) => {
        console.error("WebSocket error:", event);
        appendMessage({ type: 'leave', user: 'System', message: 'WebSocket connection failed. Please ensure the server is running and try again.', ts: Date.now() / 1000 });
        showToast('Connection error. Please try again.', 'error');
        // Ensure connection is fully closed and UI reset on error
        if (ws && ws.readyState !== WebSocket.CLOSED) {
            ws.close();
        } else {
            displayLandingPage();
        }
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
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendButton.click();
    }
});

messageInput.addEventListener('input', autoResizeTextarea);
messagesDiv.addEventListener('scroll', () => ensureScrolledToBottom(false));
if (scrollBottomBtn) {
    scrollBottomBtn.addEventListener('click', () => ensureScrolledToBottom(true));
}

// Simple emoji panel
const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😎','😢','😭','😡','👍','👎','🙏','👏','🎉','✨','🔥','🌟','💯','🚀','🎯','🧠','💡','📌','✅','❌','⭐','🍀','🥳','😴','🤔','🤝','🫡'];
function renderEmojiPanel() {
    if (!emojiPanel) return;
    emojiPanel.innerHTML = '';
    EMOJIS.forEach(e => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = e;
        b.addEventListener('click', () => {
            messageInput.value += e;
            autoResizeTextarea();
            messageInput.focus();
        });
        emojiPanel.appendChild(b);
    });
}
if (emojiToggle) {
    emojiToggle.addEventListener('click', () => {
        if (emojiPanel.style.display === 'none' || !emojiPanel.style.display) {
            renderEmojiPanel();
            emojiPanel.style.display = 'grid';
        } else {
            emojiPanel.style.display = 'none';
        }
    });
}

// Mobile sidebar toggle
if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;
        sidebar.classList.toggle('open');
    });
}

joinRoomButton.addEventListener('click', connectToRoom);
leaveRoomButton.addEventListener('click', disconnectFromRoom);

roomTags.forEach(tag => {
    tag.addEventListener('click', () => {
        roomInput.value = tag.dataset.room;
        // Require user to provide a password explicitly
        if (!usernameInput.value.trim()) {
            usernameInput.focus();
        } else {
            roomPasswordInput.focus();
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
