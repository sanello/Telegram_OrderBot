// Загрузка переменных окружения из .env
require('dotenv').config();

// Импорт необходимых библиотек
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const jwt = require('jsonwebtoken');
const url = require('url');

// Получение переменных окружения
const SOCKET_PATH = process.env.SOCKET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const JWT_SECRET = process.env.JWT_SECRET;

// Проверка наличия обязательной переменной окружения SOCKET
if (!SOCKET_PATH) {
  console.error('Ошибка: переменная окружения SOCKET не задана');
  process.exit(1);
}

// Удаление старого сокета, если он существует
if (fs.existsSync(SOCKET_PATH)) {
  fs.unlinkSync(SOCKET_PATH);
}

// Создание экземпляров сервера и WebSocket
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// Сет клиентов WebSocket
const clients = new Set();

// Кеш товаров, по коду товара
const productCache = new Map();
// Кеш заказов по номеру
const orderCache = new Map();

/**
 * Верификация пользователя
 */

const crypto = require('crypto');

function parseInitData(initDataString) {
  const params = new URLSearchParams(initDataString);
  const userStr = params.get('user');
  if (!userStr) return null;

  try {
    const user = JSON.parse(decodeURIComponent(userStr));
    return user;
  } catch (e) {
    console.error('Ошибка парсинга user из initData:', e);
    return null;
  }
}

function validateInitData(initDataRaw) {

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(TELEGRAM_BOT_TOKEN)
    .digest();

  const urlParams = new URLSearchParams(initDataRaw);
  const receivedHash = urlParams.get('hash');
  urlParams.delete('hash');

  const entries = [...urlParams.entries()];

  const dataCheckString = entries
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const isValid = computedHash === receivedHash;
  console.log(isValid ? '✔️ Подпись валидна' : '❌ Подпись НЕВЕРНА');

  return isValid;
}


/**
 * Кеширование товара с автоматическим удалением через 15 секунд
 */
function cacheProduct(productCode, data) {
  if (productCache.has(productCode)) {
    clearTimeout(productCache.get(productCode).timeout);
  }

  const timeout = setTimeout(() => {
    productCache.delete(productCode);
    console.log(`Кеш очищен: ${productCode}`);
  }, 15 * 1000);

  productCache.set(productCode, { data, timeout });
}

/**
 * Кеширование заказа с автоматическим удалением через 3 часа
 */

function cacheOrder(orderNumber, items) {
  if (orderCache.has(orderNumber)) {
    clearTimeout(orderCache.get(orderNumber).timeout);
  }

  const timeout = setTimeout(() => {
    orderCache.delete(orderNumber);
    console.log(`Кеш заказа удалён: ${orderNumber}`);
  }, 180 * 60 * 1000); // 3 часа

  orderCache.set(orderNumber, { data: items, timeout });
}


/**
 * Рассылка сообщения конкретному WebSocket клиенту по chatId
 */
function broadcastToClients(data) {
  let targetChatId = null;
  
  // Если есть initData - парсим и выводим user id
  if (data.initData) {
    const user = parseInitData(data.initData);
    if (user && user.id) {
      console.log('ID пользователя из initData:', user.id);
      data.chatId = user.id;  // добавляем в JSON поле chat
      targetChatId = String(user.id);
    } else {
      console.log('initData присутствует, но user_id не найден');
    }
  }
  
   if (!targetChatId) {
    console.warn('targetChatId не определён — сообщение не отправлено');
    return;
  }
  
  const message = JSON.stringify(data);

  for (const client of clients) {
    if (
      client.readyState === WebSocket.OPEN &&
      String(client.user?.user_id) === targetChatId
    ) {
      client.send(message);
    }
  }
}

/**
 * Обработка входящих WebSocket соединений
 */
wss.on('connection', (ws) => {
  console.log(`Подключён клиент: ${ws.user?.user_id || 'неизвестный'}`);
  clients.add(ws);

  // Отправка информации при подключении
  ws.send(JSON.stringify({
    chatId: ws.user?.user_id,
    type: 'info',
    message: 'WebSocket-соединение установлено'
  }));

  // Обработка сообщений от клиента
  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);
      if (typeof data !== 'object') throw new Error();

      // Обработка типа "ostatki" — кеширование товара
      if (data.type === 'ostatki' && data.data?.productCode) {
        cacheProduct(data.data.productCode, data);
        console.log(`Кеширован товар: ${data.data.productCode}`);
      }

      // Обработка типа "ordernumber" — отправка заказа в Telegram
      if (data.type === 'ordernumber' && data.data?.order_summary && data.chatId) {
          
        if (data.data?.number && Array.isArray(data.data.items)) {
            //orderCache.set(data.data.number, data.data.items);
            orderCache.set(data.data.number, { data: data.data.items });
            console.log(`Кеширован заказ: ${data.data.number}`);
        }
        await sendTelegramOrderMessage(data.chatId, data.data.number, data.data.order_summary);
      }
      
      // Обработка типа "deleteordernumber"
      if (data.type === 'deleteordernumber' && data.data?.number && data.chatId) {
        console.log(`Обработка запроса на удаление заказа: ${data.data.number} для chatId: ${data.chatId}`);
        await sendTelegramDeleteMessage(data.chatId, data.data.number);
      }

      ws.send(JSON.stringify({ type: 'success', message: 'Данные обработаны' }));
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Ошибка разбора JSON' }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket-клиент отключился');
    clients.delete(ws);
  });
});

// Создание и настройка Telegram бота
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Обработка ошибок polling
bot.on("polling_error", (err) =>
  console.error("Polling error:", err?.response?.body || err.message)
);

/**
 * Генерация JWT токена для пользователя
 */
function generateToken(userId) {
  return jwt.sign({
    user_id: userId,
    exp: Math.floor(Date.now() / 1000) + (3650 * 24 * 60 * 60), // 10 лет
  }, JWT_SECRET, { algorithm: 'HS256' });
}

/**
 * Чтение разрешённых chat ID из файла
 */
function getAllowedChatIds() {
  const data = fs.readFileSync('allowedChatIds.txt', 'utf-8');
  return new Set(data.split('\n').map(l => l.split(' ')[0].trim()).filter(Boolean));
}

// Установка разрешённых chat ID
const allowedChatIds = getAllowedChatIds();

/**
 * Обработка команды /start от пользователя
 * Отправляет chat ID и JWT токен, если ID разрешён
 */
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const token = generateToken(userId);

  const welcomeMessage = allowedChatIds.has(String(chatId))
    ? ` 
Привет! 🙋‍♂️ Это твой личный Telegram-бот.

🛠 Чтобы настроить работу с Telegram API, сделай следующее:

1. Перейди на [my.telegram.org](https://my.telegram.org/)
2. Войди под своим номером
3. Создай приложение и получи два параметра:

- **API ID** — уникальный ID приложения
- **API Hash** — хеш приложения

🔐 Твой **chat ID**: 
\`
${chatId}
\`
🔑 Твой **JWT Token** (действует 10 лет):
\`\`\`
${token}
\`\`\`
Добавь эти данные в конфиг своего приложения (config.env). 
Удачи! 🚀
`

        /**
        * Сообщение если пользователя нет в списке разрешённых
        */
        
        : `❌ Ваш chat ID \`${chatId}\` не разрешён. Обратитесь к администратору.`;

// Проверка разрешённости chatId перед отправкой сообщения с кнопкой
if (allowedChatIds.has(String(chatId))) {
  bot.sendMessage(chatId, welcomeMessage, {
    parse_mode: 'Markdown',
    reply_markup: {
        inline_keyboard: [
            [
                {
                    text: '🔑 my.telegram.org',
                    web_app: {
                        url: `https://my.telegram.org/`
                    }
                }
            ]
        ]
    }

  });
} else {
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
}
  
});

/**
 * Отправка сообщения с номером заказа и кнопкой в Telegram
 */
async function sendTelegramOrderMessage(chatId, orderNumber, order_summary) {
  const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Chisinau' });
  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const res = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${now}: ${order_summary}`,
        reply_markup: {
            inline_keyboard: [[
                {
                text: '➕Создать новый',
                web_app: {
                    url: `https://order.warflame.net`
                }
                },
                {
                text: '✏️Редактировать',
                web_app: {
                    url: `https://order.warflame.net/?orderNumber=${orderNumber}`
                }
                }
            ]]
            }
      })
    });

    const json = await res.json();
    if (!json.ok) throw new Error(JSON.stringify(json));
    console.log(`Заказ ${orderNumber} отправлен ${chatId}`);
  } catch (err) {
    console.error('Ошибка Telegram API:', err.message || err);
  }
}

async function sendTelegramDeleteMessage(chatId, orderNumber) {
    
    if (!orderNumber) {
        console.error('Заказ не имеет номера.');
        return;
    }
    
  const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Chisinau' });
  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const res = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${now}: Заказ ${orderNumber} удалён!`,
        reply_markup: {
            inline_keyboard: [[
                {
                text: '➕Создать новый',
                web_app: {
                    url: `https://order.warflame.net`
                }
                },
                {
                text: '✏️Восстановить',
                web_app: {
                    url: `https://order.warflame.net/?orderNumber=${orderNumber}`
                }
                }
            ]]
            }
      })
    });

    console.log(`Заказ ${orderNumber} удалён ${chatId}`);
  } catch (err) {
    console.error('Ошибка Telegram API:', err.message || err);
  }
}

// ==== Express Middleware и маршруты ====
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * POST /order
 * Получение данных заказа от фронтенда и рассылка по WebSocket клиентам
 */
app.post('/order', (req, res) => {
  const initData = req.body.initData;
  
  console.log('Получен запрос /order:', req.body);

  if (!initData) {
    return res.status(400).send('initData отсутствует');
  }

  try {
    const data = validateInitData(initData);
    
    // Передаём заказ WebSocket-клиентам
    broadcastToClients(req.body);

    res.status(200).send('Заказ отправлен клиентам');
  } catch (err) {
    console.error('Ошибка валидации initData:', err.message);
    res.status(403).send('Неверный initData');
  }
});

/**
 * GET /product-details
 * Отдаёт закешированные данные о товаре по коду
 */
app.get('/product-details', (req, res) => {
  const cached = productCache.get(req.query.productCode);
  cached ? res.json(cached.data) : res.status(404).json({ error: 'Товар не найден' });
});

/**
 * GET /order-items
 * Отдаёт закешированные товары по номеру заказа
 * Пример: /order-items?orderNumber=144786
 */
app.get('/order-items', (req, res) => {
  console.log('Текущий кэш:', [...orderCache.entries()]);
  const order = orderCache.get(req.query.orderNumber);
  order ? res.json(order.data) : res.status(404).json({ error: 'Заказ не найден' });
});

// Корневая страница
app.get('/', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

/**
 * Обработка апгрейда соединения до WebSocket с авторизацией по JWT
 */
server.on('upgrade', (req, socket, head) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname !== '/ws/') return socket.destroy();

  const token = parsedUrl.query?.token;
  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }

  try {
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      wss.emit('connection', ws, req);
    });
  } catch (err) {
    console.error('Неверный токен:', err.message);
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
  }
});

/**
 * Запуск сервера и установка прав на сокет
 */
server.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o660);
  console.log(`Сервер запущен: ${SOCKET_PATH}`);
});
