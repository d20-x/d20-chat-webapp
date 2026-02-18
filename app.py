import os
import json
import logging
import requests
from datetime import datetime
from typing import Dict, Optional
from hashlib import sha256
import hmac
from urllib.parse import parse_qs

from flask import Flask, render_template, request, jsonify
from flask_sock import Sock
from flask_cors import CORS

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Инициализация Flask
app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'change-this-in-production')
CORS(app)

# WebSocket
sock = Sock(app)

# Конфигурация
BOT_TOKEN = os.getenv('BOT_TOKEN')
YANDEX_CLOUD_API = os.getenv('YANDEX_CLOUD_API', '')  # API на Yandex Cloud

# Активные WebSocket подключения
active_connections: Dict[int, any] = {}

# ==================== API INTEGRATION ====================

def api_request(method: str, endpoint: str, data: dict = None) -> dict:
    """Запрос к API на Yandex Cloud"""
    try:
        if not YANDEX_CLOUD_API:
            logger.warning("YANDEX_CLOUD_API not configured")
            return None
        
        url = f"{YANDEX_CLOUD_API}/{endpoint}"
        
        if method == 'GET':
            response = requests.get(url, params=data, timeout=10)
        else:
            response = requests.post(url, json=data, timeout=10)
        
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logger.error(f"API request error: {e}")
        return None

# ==================== ROUTES ====================

@app.route('/')
def index():
    """Главная страница с чатом"""
    return render_template('chat.html')

@app.route('/health')
def health():
    """Health check для Railway"""
    return jsonify({
        'status': 'healthy',
        'online_users': len(active_connections),
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/user/profile', methods=['POST'])
def get_user_profile():
    """Получение профиля пользователя"""
    data = request.json
    user_id = data.get('user_id')
    
    if not user_id:
        return jsonify({'error': 'No user_id'}), 400
    
    # Запрос к API на Yandex Cloud
    result = api_request('GET', 'user/profile', {'user_id': user_id})
    
    if not result:
        return jsonify({'error': 'User not found'}), 404
    
    return jsonify(result)

@app.route('/api/messages', methods=['GET'])
def get_messages():
    """Получение сообщений"""
    limit = int(request.args.get('limit', 30))
    before_id = request.args.get('before_id')
    
    params = {'limit': limit}
    if before_id:
        params['before_id'] = int(before_id)
    
    result = api_request('GET', 'messages', params)
    
    if result:
        return jsonify(result)
    else:
        return jsonify({'messages': [], 'has_more': False})

@app.route('/api/send_message', methods=['POST'])
def send_message():
    """Отправка сообщения"""
    data = request.json
    init_data = data.get('init_data', '')
    
    # Извлечение user_id из init_data
    try:
        parsed = parse_qs(init_data)
        user_data = json.loads(parsed.get('user', ['{}'])[0])
        user_id = user_data.get('id')
    except:
        return jsonify({'error': 'Invalid init_data'}), 401
    
    text = data.get('text', '').strip()
    reply_to_id = data.get('reply_to_id')
    
    if not text or len(text) > 1000:
        return jsonify({'error': 'Invalid message'}), 400
    
    # Сохранение через API на Yandex Cloud
    message = api_request('POST', 'send_message', {
        'user_id': user_id,
        'text': text,
        'reply_to_id': reply_to_id
    })
    
    if not message:
        return jsonify({'error': 'Failed to save message'}), 500
    
    # Отправка всем подключенным
    broadcast_message({
        'type': 'new_message',
        'message': message
    })
    
    return jsonify({'success': True, 'message': message})

@app.route('/api/online_count', methods=['GET'])
def get_online_count():
    """Получение количества онлайн"""
    return jsonify({'count': len(active_connections)})

# ==================== WEBSOCKET ====================

@sock.route('/ws')
def websocket(ws):
    """WebSocket соединение"""
    user_id = None
    
    try:
        init_data = request.args.get('init_data', '')
        
        try:
            parsed = parse_qs(init_data)
            user_data = json.loads(parsed.get('user', ['{}'])[0])
            user_id = user_data.get('id')
        except:
            ws.close(reason='Invalid init_data')
            return
        
        if not user_id:
            ws.close(reason='No user_id')
            return
        
        active_connections[user_id] = ws
        logger.info(f"User {user_id} connected. Total: {len(active_connections)}")
        
        # Получаем никнейм через API
        profile = api_request('GET', 'user/profile', {'user_id': user_id})
        
        if profile:
            broadcast_message({
                'type': 'user_joined',
                'user_id': user_id,
                'nickname': profile.get('nickname')
            }, exclude_user=user_id)
        
        broadcast_message({
            'type': 'online_count',
            'count': len(active_connections)
        })
        
        while True:
            data = ws.receive()
            if data is None:
                break
    
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    
    finally:
        if user_id and user_id in active_connections:
            del active_connections[user_id]
            logger.info(f"User {user_id} disconnected")
            
            profile = api_request('GET', 'user/profile', {'user_id': user_id})
            if profile:
                broadcast_message({
                    'type': 'user_left',
                    'user_id': user_id,
                    'nickname': profile.get('nickname')
                }, exclude_user=user_id)
            
            broadcast_message({
                'type': 'online_count',
                'count': len(active_connections)
            })

def broadcast_message(message: dict, exclude_user: Optional[int] = None):
    """Отправка всем подключенным"""
    disconnected = []
    
    for user_id, ws in list(active_connections.items()):
        if exclude_user and user_id == exclude_user:
            continue
        
        try:
            ws.send(json.dumps(message))
        except:
            disconnected.append(user_id)
    
    for user_id in disconnected:
        active_connections.pop(user_id, None)

# ==================== MAIN ====================

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    logger.info(f"🚀 D20 Chat WebApp starting on port {port}")
    logger.info(f"🌐 API: {YANDEX_CLOUD_API or 'Not configured'}")
    
    app.run(host='0.0.0.0', port=port, debug=False)
