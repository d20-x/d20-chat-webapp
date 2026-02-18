// Инициализация Telegram Web App
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Конфигурация
const API_URL = window.location.origin;
const WS_URL = API_URL.replace('http', 'ws') + '/ws';

// Глобальные переменные
let ws = null;
let currentUser = null;
let messages = [];
let replyToMessage = null;
let oldestMessageId = null;
let isLoadingHistory = false;

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    initChat();
    setupEventListeners();
});

// Инициализация чата
async function initChat() {
    try {
        // Получение данных пользователя
        const initData = tg.initData || '';
        const userId = tg.initDataUnsafe?.user?.id;
        
        if (!userId) {
            showError('Ошибка авторизации');
            return;
        }

        // Загрузка профиля пользователя
        const response = await fetch(`${API_URL}/api/user/profile`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                init_data: initData,
                user_id: userId
            })
        });

        if (!response.ok) {
            throw new Error('Ошибка загрузки профиля');
        }

        currentUser = await response.json();
        
        // Загрузка последних сообщений
        await loadMessages();
        
        // Подключение WebSocket
        connectWebSocket(initData);
        
        // Загрузка количества онлайн
        loadOnlineCount();
        
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        showError('Не удалось загрузить чат');
    }
}

// Подключение к WebSocket
function connectWebSocket(initData) {
    ws = new WebSocket(`${WS_URL}?init_data=${encodeURIComponent(initData)}`);
    
    ws.onopen = () => {
        console.log('WebSocket подключен');
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket ошибка:', error);
    };
    
    ws.onclose = () => {
        console.log('WebSocket отключен, переподключение...');
        setTimeout(() => connectWebSocket(initData), 3000);
    };
}

// Обработка WebSocket сообщений
function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'new_message':
            addMessage(data.message);
            break;
        case 'online_count':
            updateOnlineCount(data.count);
            break;
        case 'user_joined':
            showSystemMessage(`${data.nickname} присоединился к чату`);
            break;
        case 'user_left':
            showSystemMessage(`${data.nickname} покинул чат`);
            break;
    }
}

// Загрузка сообщений
async function loadMessages(before_id = null) {
    try {
        const url = before_id 
            ? `${API_URL}/api/messages?before_id=${before_id}&limit=30`
            : `${API_URL}/api/messages?limit=30`;
            
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.messages && data.messages.length > 0) {
            if (before_id) {
                // Добавление старых сообщений вверх
                messages = [...data.messages.reverse(), ...messages];
                renderMessagesAbove(data.messages);
            } else {
                // Первая загрузка
                messages = data.messages.reverse();
                renderMessages();
                scrollToBottom(false);
            }
            
            oldestMessageId = data.messages[0].id;
            
            // Показать кнопку загрузки если есть еще сообщения
            const loadMoreBtn = document.getElementById('loadMoreBtn');
            if (data.has_more) {
                loadMoreBtn.style.display = 'block';
            } else {
                loadMoreBtn.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки сообщений:', error);
    }
}

// Загрузка старых сообщений
async function loadMoreMessages() {
    if (isLoadingHistory || !oldestMessageId) return;
    
    isLoadingHistory = true;
    const container = document.getElementById('messagesContainer');
    const scrollHeightBefore = container.scrollHeight;
    
    await loadMessages(oldestMessageId);
    
    // Сохранение позиции скролла
    const scrollHeightAfter = container.scrollHeight;
    container.scrollTop = scrollHeightAfter - scrollHeightBefore;
    
    isLoadingHistory = false;
}

// Отрисовка всех сообщений
function renderMessages() {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    messages.forEach(msg => {
        container.appendChild(createMessageElement(msg));
    });
}

// Отрисовка сообщений сверху
function renderMessagesAbove(newMessages) {
    const container = document.getElementById('messagesContainer');
    const fragment = document.createDocumentFragment();
    
    newMessages.forEach(msg => {
        fragment.appendChild(createMessageElement(msg));
    });
    
    container.insertBefore(fragment, container.firstChild);
}

// Добавление нового сообщения
function addMessage(message) {
    messages.push(message);
    const container = document.getElementById('messagesContainer');
    const messageElement = createMessageElement(message);
    
    container.appendChild(messageElement);
    
    // Автоскролл если пользователь внизу
    if (isNearBottom()) {
        scrollToBottom(true);
    } else {
        showScrollButton();
    }
}

// Создание элемента сообщения
function createMessageElement(msg) {
    const div = document.createElement('div');
    div.className = 'message';
    div.dataset.messageId = msg.id;
    
    // Заголовок сообщения
    const header = document.createElement('div');
    header.className = 'message-header';
    
    // Ранг
    const rankBadge = document.createElement('span');
    rankBadge.className = 'rank-badge';
    rankBadge.textContent = msg.rank_emoji || '👤';
    header.appendChild(rankBadge);
    
    // Уровень
    const levelBadge = document.createElement('span');
    levelBadge.className = 'level-badge';
    levelBadge.textContent = msg.chat_level || '1';
    header.appendChild(levelBadge);
    
    // Никнейм
    const nickname = document.createElement('span');
    nickname.className = 'nickname';
    nickname.textContent = msg.nickname;
    nickname.onclick = () => replyToUser(msg);
    header.appendChild(nickname);
    
    // Эмодзи суффикс
    if (msg.emoji_suffix) {
        const emoji = document.createElement('span');
        emoji.className = 'emoji-suffix';
        emoji.textContent = msg.emoji_suffix;
        header.appendChild(emoji);
    }
    
    // Время
    const timestamp = document.createElement('span');
    timestamp.className = 'timestamp';
    timestamp.textContent = formatTime(msg.timestamp);
    header.appendChild(timestamp);
    
    div.appendChild(header);
    
    // Содержимое сообщения
    const content = document.createElement('div');
    content.className = 'message-content';
    
    // Ответ на сообщение
    if (msg.reply_to) {
        const replyDiv = document.createElement('div');
        replyDiv.className = 'reply-to';
        
        const replyNickname = document.createElement('span');
        replyNickname.className = 'reply-to-nickname';
        replyNickname.textContent = msg.reply_to.nickname;
        replyDiv.appendChild(replyNickname);
        
        const replyText = document.createElement('div');
        replyText.className = 'reply-to-text';
        replyText.textContent = msg.reply_to.text;
        replyDiv.appendChild(replyText);
        
        content.appendChild(replyDiv);
    }
    
    // Текст сообщения
    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = msg.text;
    content.appendChild(text);
    
    div.appendChild(content);
    
    return div;
}

// Показ системного сообщения
function showSystemMessage(text) {
    const container = document.getElementById('messagesContainer');
    const div = document.createElement('div');
    div.className = 'system-message';
    div.textContent = text;
    container.appendChild(div);
    
    if (isNearBottom()) {
        scrollToBottom(true);
    }
}

// Ответ на сообщение пользователя
function replyToUser(message) {
    replyToMessage = message;
    
    const replyBlock = document.getElementById('replyBlock');
    const replyText = document.getElementById('replyText');
    
    replyText.innerHTML = `
        <strong>${message.nickname}:</strong> ${message.text}
    `;
    
    replyBlock.style.display = 'block';
    document.getElementById('messageInput').focus();
    
    // Вибрация
    if (tg.HapticFeedback) {
        tg.HapticFeedback.selectionChanged();
    }
}

// Отмена ответа
function cancelReply() {
    replyToMessage = null;
    document.getElementById('replyBlock').style.display = 'none';
}

// Отправка сообщения
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (!text || text.length > 1000) return;
    
    try {
        const response = await fetch(`${API_URL}/api/send_message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                init_data: tg.initData,
                text: text,
                reply_to_id: replyToMessage?.id || null
            })
        });
        
        if (response.ok) {
            input.value = '';
            updateCharCounter();
            autoResizeTextarea(input);
            cancelReply();
            
            // Вибрация
            if (tg.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred('success');
            }
        } else {
            const error = await response.json();
            showError(error.detail || 'Ошибка отправки сообщения');
            
            if (tg.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred('error');
            }
        }
    } catch (error) {
        console.error('Ошибка отправки:', error);
        showError('Не удалось отправить сообщение');
    }
}

// Настройка обработчиков событий
function setupEventListeners() {
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendButton');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    const scrollBtn = document.getElementById('scrollToBottom');
    const container = document.getElementById('messagesContainer');
    
    // Ввод текста
    input.addEventListener('input', (e) => {
        updateCharCounter();
        autoResizeTextarea(e.target);
        sendBtn.disabled = !e.target.value.trim();
    });
    
    // Enter для отправки
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) {
                sendMessage();
            }
        }
    });
    
    // Кнопка отправки
    sendBtn.addEventListener('click', sendMessage);
    
    // Загрузка старых сообщений
    loadMoreBtn.addEventListener('click', loadMoreMessages);
    
    // Кнопка скролла вниз
    scrollBtn.addEventListener('click', () => scrollToBottom(true));
    
    // Отслеживание скролла
    container.addEventListener('scroll', () => {
        if (isNearBottom()) {
            hideScrollButton();
        } else {
            showScrollButton();
        }
    });
}

// Автоматическое изменение высоты textarea
function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// Обновление счетчика символов
function updateCharCounter() {
    const input = document.getElementById('messageInput');
    const counter = document.getElementById('charCounter');
    const length = input.value.length;
    counter.textContent = `${length}/1000`;
    
    if (length > 900) {
        counter.style.color = 'var(--warning)';
    } else {
        counter.style.color = 'var(--text-muted)';
    }
}

// Форматирование времени
function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'только что';
    if (diffMins < 60) return `${diffMins} мин назад`;
    
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    if (date.toDateString() === now.toDateString()) {
        return `${hours}:${minutes}`;
    }
    
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${day}.${month} ${hours}:${minutes}`;
}

// Скролл вниз
function scrollToBottom(smooth = true) {
    const container = document.getElementById('messagesContainer');
    container.scrollTo({
        top: container.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
    });
}

// Проверка близости к низу
function isNearBottom() {
    const container = document.getElementById('messagesContainer');
    const threshold = 100;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

// Показать кнопку скролла
function showScrollButton() {
    document.getElementById('scrollToBottom').style.display = 'flex';
}

// Скрыть кнопку скролла
function hideScrollButton() {
    document.getElementById('scrollToBottom').style.display = 'none';
}

// Обновление счетчика онлайн
function updateOnlineCount(count) {
    document.getElementById('onlineCount').textContent = count;
}

// Загрузка количества онлайн
async function loadOnlineCount() {
    try {
        const response = await fetch(`${API_URL}/api/online_count`);
        const data = await response.json();
        updateOnlineCount(data.count);
    } catch (error) {
        console.error('Ошибка загрузки онлайн:', error);
    }
}

// Показ модального окна профиля
function showProfileModal(userId) {
    // TODO: Реализовать показ профиля
    const modal = document.getElementById('profileModal');
    modal.style.display = 'flex';
}

// Закрытие модального окна
function closeProfileModal() {
    const modal = document.getElementById('profileModal');
    modal.style.display = 'none';
}

// Показ ошибки
function showError(message) {
    tg.showAlert(message);
}

// Обновление онлайн каждые 30 секунд
setInterval(loadOnlineCount, 30000);
