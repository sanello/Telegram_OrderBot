import asyncio
import json
import os
import random
import re

import textwrap
import websockets
from telethon import TelegramClient, events
import win32print
import win32ui
from dotenv import load_dotenv
import qrcode
from PIL import Image
import win32con

import builtins
from datetime import datetime

original_print = builtins.print

import logging
logging.getLogger('telethon.network.mtprotosender').setLevel(logging.WARNING)

# Загрузка переменных окружения
load_dotenv('./config.env')

API_ID = os.getenv("API_ID")
API_HASH = os.getenv("API_HASH")
BOT_USERNAME = os.getenv("BOT_USERNAME")
CHAT_ID = int(os.getenv("CHAT_ID"))
PRINTER_NAME = os.getenv("PRINTER_NAME")
WEBSOCKET_TOKEN = os.getenv("WEBSOCKET_TOKEN")
WEBSOCKET_URI = f"wss://order.warflame.net/ws/?token={WEBSOCKET_TOKEN}"

# Глобальная переменная для последнего сообщения
last_bot_message = None
message_processing_flag = False  # Флаг для предотвращения повторной обработки

# Инициализация Telegram клиента
client = TelegramClient('session_name', API_ID, API_HASH)

def print(*args, **kwargs):
    time_prefix = datetime.now().strftime("[%H:%M:%S]")
    original_print(time_prefix, *args, **kwargs)

# ----------- Печать чека -----------
def print_text(printer_name: str, text: str):
    try:
        hdc = _create_printer_dc(printer_name)
        page_width = hdc.GetDeviceCaps(110)
        y = 0

        # Подготовка данных
        order_number = _extract_order_number(text)
        itogo_line = None

        small_font = _create_font(20, weight=400)
        large_font = _create_font(80, weight=700)
        order_font = _create_font(100, weight=700)
        
        # Заголовок
        hdc.SelectObject(small_font)
        y = _center_text(hdc, page_width, "ЗАКАЗ КЛИЕНТА", y)

        y += 20
        stars_line = '*' * page_width
        hdc.TextOut(0, y, stars_line)
        y += 10

        # Номер заказа
        hdc.SelectObject(order_font)
        _draw_qr_code(hdc, order_number, 0, y)
        hdc.TextOut(100, y, order_number)
        y += 100

        hdc.SelectObject(small_font)
        hdc.TextOut(0, y, stars_line)
        y += 10
     
        # Основной текст
        for line in text.splitlines():
            if line.startswith("** Итого к оплате:"):
                itogo_line = line
                continue

            # Переносим длинные строки по словам, не обрывая
            wrapped_lines = textwrap.wrap(line, width=45)

            for wrapped_line in wrapped_lines:
                hdc.TextOut(0, y, wrapped_line)
                y += 20
                
        hdc.SelectObject(small_font)
        hdc.TextOut(0, y, stars_line)
        y += 10

        # Блок итоговой суммы
        if itogo_line:
            y = _draw_final_amount(hdc, page_width, itogo_line, y, small_font, large_font)

        hdc.SelectObject(small_font)
        hdc.TextOut(0, y, stars_line)
        y += 20

        # Рандомная фраза
        y = _draw_random_phrase(hdc, page_width, y)

        # Завершение
        hdc.EndPage()
        hdc.EndDoc()
        hdc.DeleteDC()

        print(f"Печать чека: Печать завершена на принтере: {printer_name}")

    except Exception as e:
        print(f"Печать чека: Ошибка при печати: {e}")

def _create_printer_dc(printer_name):
    hdc = win32ui.CreateDC()
    hdc.CreatePrinterDC(printer_name)
    hdc.StartDoc("TelegramBotOrder")
    hdc.StartPage()
    return hdc

def _create_font(height, weight):
    return win32ui.CreateFont({"name": "Arial", "height": height, "weight": weight})

def _center_text(hdc, page_width, text, y):
    text_width = hdc.GetTextExtent(text)[0]
    hdc.TextOut((page_width - text_width) // 2, y, text)
    return y

def _extract_order_number(text):
    match = re.search(r"Заказ клиента №[-]?(\d+)", text)
    return match.group(1).lstrip("0") if match else "Нет кода"

def _draw_final_amount(hdc, page_width, line, y, small_font, large_font):
    clean_line = re.sub(r"(руб\.?|ПМР)", "", line.replace("**", "").strip(), flags=re.IGNORECASE)
    match = re.search(r"(\d{1,3}(?:[ \u00A0]\d{3})*),\d{2}", clean_line)
    if match:
        amount = match.group(1).replace("\u00A0", " ").strip()
        hdc.SelectObject(large_font)
        y = _center_text(hdc, page_width, "К оплате:", y)
        y += 80
        y = _center_text(hdc, page_width, f"{amount} руб.", y)
        y += 80
    return y

def _draw_qr_code(hdc, order_number, x, y, size=100):
    from PIL import ImageWin

    # 1. Генерация QR-кода
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=1,
    )
    qr.add_data(order_number)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    img = img.resize((size, size), Image.LANCZOS)

    # 2. Конвертация в DIB и вывод на hdc
    dib = ImageWin.Dib(img)
    dib.draw(hdc.GetHandleOutput(), (x, y, x + size, y + size))


def _draw_random_phrase(hdc, page_width, y):
    phrases = [
            "Спасибо за покупку! Теперь вы официально беднее, но счастливее!",
            "Этот чек можно обменять на тёплую улыбку кассира. Только один раз!",
            "Сожгите этот чек — и все калории из покупки исчезнут!",
            "Поздравляем! Вы только что прошли квест: 'Выстоять в очереди'!",
            "Чек не съедобен. Проверено.",
            "Покупая у нас, вы автоматически соглашаетесь на хорошее настроение!",
            "Если вы потеряете этот чек, он вас тоже не найдёт.",
            "Сохраните этот чек — он может стать антиквариатом.",
            "Покупки — это тоже спорт. Поздравляем с личным рекордом!",
            "Спасибо, что помогли нашей кассе не заскучать!",
            "Чек не подделка. Но всё равно выглядит подозрительно.",
            "С этим чеком вы официально становитесь нашим любимым клиентом.",
            "Шутка дня: ваша карта одобрила покупку.",
            "Спасибо за покупку! Теперь вы на 20% технологичнее.",
            "Ваша техника рада, что вы её выбрали. Почти как кот из приюта.",
            "Этот чек не заряжается, но тоже полезен!",
            "Покупка подтверждена. Осталось только объяснить дома зачем.",
            "Внимание! Кассир не несет ответственности за ваше желание купить ещё больше."
    ]
    phrase = random.choice(phrases)
    max_length = 42
    lines = textwrap.wrap(phrase, width=max_length)

    small_font = _create_font(20, 400)
    hdc.SelectObject(small_font)
    for line in lines:
        width = hdc.GetTextExtent(line)[0]
        hdc.TextOut((page_width - width) // 2, y, line)
        y += 20
    return y

# ----------- Работа с WebSocket -----------
async def send_order_number_to_server(chat_id: int, order_summary: str, original_data: list):
    number_order = _extract_order_number(order_summary)
    result = {
        "chatId": chat_id,
        "type": "ordernumber",
        "data": {
            "number": number_order,
            "order_summary": order_summary,
            "items": original_data
        }
    }
    await _send_websocket_message(result)

async def send_delete_message_to_server(chat_id: int, order_number: int):
    result = {
        "chatId": chat_id,
        "type": "deleteordernumber",
        "data": {
            "number": order_number
        }
    }
    await _send_websocket_message(result)

async def handle_ostatki(message: str, chat_id: int = CHAT_ID):
    try:
        header = re.search(r"\*\*Т-(\d+)\s+(.+?)\n", message)
        if not header:
            print("Работа с WebSocket: Ошибка - не найден заголовок товара в остатках.")
            return

        code, name = header.groups()
        stores = [
            {"store": store.strip(), "quantity": quantity.strip().replace(" шт. и более", "+")}
            for store, quantity in re.findall(r"- (.*?)\*\*\s*/\s*(.*?)\s*\*\*", message)
        ]

        result = {
            "chatId": chat_id,
            "type": "ostatki",
            "data": {
                "productCode": code,
                "productName": name.strip(),
                "availability": stores
            }
        }
        await _send_websocket_message(result)
    except Exception as e:
        print(f"Работа с WebSocket: Ошибка обработки остатков: {e}")

async def _send_websocket_message(data):
    async with websockets.connect(WEBSOCKET_URI) as websocket:
        await websocket.send(json.dumps(data, ensure_ascii=False))
        print(f"Работа с WebSocket: Отправлен JSON: {data}")

# ----------- Работа с Telegram -----------
async def send_message_to_bot(message: str):
    bot = await client.get_entity(BOT_USERNAME)
    await client.send_message(bot, message)
    print(f"Работа с Telegram: Сообщение отправлено боту: {message}")

async def wait_for_bot_response(expected_start, timeout=10):
    global last_bot_message, message_processing_flag
    expected_start = (expected_start,) if isinstance(expected_start, str) else expected_start
    print(f"Работа с Telegram: Ожидание ответа от бота, ожидаемое начало: {expected_start}, таймаут: {timeout} сек")

    for i in range(timeout * 10):
        if last_bot_message and not message_processing_flag:
            message_processing_flag = True  # Фиксируем начало обработки
            print(f"Работа с Telegram: Получено сообщение: {last_bot_message}")
            if "закрыт, создайте новый" in last_bot_message.lower():
                print("Работа с Telegram: Заказ закрыт. Операция прервана.")
                message_processing_flag = False
                last_bot_message = None
                return None  # Прекратить выполнение
            if any(msg in last_bot_message for msg in expected_start):
                print("Работа с Telegram: Найдено ожидаемое сообщение от бота")
                result = last_bot_message
                last_bot_message = None  # Сбросить переменную после обработки
                message_processing_flag = False  # Разблокировать обработку новых сообщений
                return result
            message_processing_flag = False  # Разблокировать обработку, если сообщение не совпало
        await asyncio.sleep(0.1)

    print("Работа с Telegram: Таймаут ожидания ответа от бота")
    return None

@client.on(events.NewMessage(chats=BOT_USERNAME))
async def bot_message_handler(event):
    global last_bot_message
    try:
        last_bot_message = event.message.text
        print(f"Работа с Telegram: Новое сообщение от бота: {last_bot_message}")

        if last_bot_message.startswith("** Доступность товара:"):
            await handle_ostatki(last_bot_message)
    except Exception as e:
        print(f"Работа с Telegram: Ошибка в bot_message_handler: {e}")
    
# ----------- Обработчик заказов -----------
async def websocket_listener():
    while True:
        try:
            print("Обработчик заказов: Подключение к WebSocket...")
            async with websockets.connect(WEBSOCKET_URI) as websocket:
                print("Обработчик заказов: Подключено к WebSocket")

                while True:
                    message = await websocket.recv()
                    data = json.loads(message)
                    print(f"Обработчик заказов: Получен json: {data}")

                    if data.get("chatId") != CHAT_ID:
                        print(f"Обработчик заказов: Пропуск сообщения для другого chatId: {data.get('chatId')}")
                        continue

                    await process_websocket_message(data)

        except websockets.exceptions.ConnectionClosedError as e:
            print(f"Обработчик заказов: WebSocket соединение закрыто: {e}")
        except Exception as e:
            print(f"Обработчик заказов: Ошибка WebSocket: {e}")

        print("Обработчик заказов: Переподключение через 5 секунд...")
        await asyncio.sleep(5)

async def process_websocket_message(data):
    if data['type'] == 'order':
        await handle_order(data)
    elif data['type'] == 'edit_order':
        await handle_edit_order(data)
    elif data['type'] == 'delete_order':
        await handle_delete_order(data)
    elif data['type'] == 'info':
        print(f"Информация: {data.get('message')}")
    elif data['type'] == 'name':
        await request_product_availability(data)
    else:
        print(f"Обработчик заказов: Неизвестный тип сообщения: {data['type']}")

async def handle_order(data):
    await send_message_to_bot("Создать заказ клиента")
    if await wait_for_bot_response("Создан заказ клиента"):
        
        # 1. Добавление новых товаров
        for item in data['data']:
            code, quantity = item['code'].lstrip("0"), item['quantity']
            msg = f"=={code}/{quantity}" if quantity > 1 else f"=={code}"
            await send_message_to_bot(msg)
            if not await wait_for_bot_response("товар успешно добавлен"):
                print("Обработчик заказов: Подтверждение не получено для товара.")

        # 2. Завершение заказа
        await send_message_to_bot("Завершить заказ")
        if order_summary := await wait_for_bot_response("Состав заказа"):
            await send_order_number_to_server(data['chatId'], order_summary, data['data'])
            print_text(PRINTER_NAME, order_summary)
    else:
        print("Обработчик заказов: Ошибка создания заказа.")

async def handle_edit_order(data):
    chat_id = data["chatId"]
    order_number = data["orderNumber"]
    total_quantity = data.get("totalQuantity", 0)

    # 1. Отправка номера заказа
    await send_message_to_bot(f"!!{order_number}")
    await wait_for_bot_response("Состав заказа")

    # 2. Удаление товаров от большего к меньшему
    for i in range(total_quantity, 0, -1):
        await send_message_to_bot(f"@{BOT_USERNAME} /СтрокаУдаления№{i}/")
        if not await wait_for_bot_response("Строка удалена"):
            print("Обработчик заказов: Ошибка - строка не удалена.")
            return  # Прерывает выполнение текущей async-функции
    # 3. Добавление новых товаров
    for item in data['data']:
        code, quantity = item['code'].lstrip("0"), item['quantity']
        msg = f"=={code}/{quantity}" if quantity > 1 else f"=={code}"
        await send_message_to_bot(msg)
        if not await wait_for_bot_response("товар успешно добавлен"):
            print("Обработчик заказов: Подтверждение не получено для товара.")

    # 4. Завершение заказа
    await send_message_to_bot("Завершить заказ")
    if order_summary := await wait_for_bot_response("Состав заказа"):
        await send_order_number_to_server(data['chatId'], order_summary, data['data'])
        print_text(PRINTER_NAME, order_summary)

async def handle_delete_order(data):
    chat_id = data["chatId"]
    order_number = data["orderNumber"]

    # 1. Отправка номера заказа
    await send_message_to_bot(f"!!{order_number}")
    await wait_for_bot_response("Состав заказа")

    # 2. Удаление заказа
    await send_message_to_bot(f"Отменить заказ")
    await wait_for_bot_response("Заказ клиента")
    
    await send_delete_message_to_server(chat_id, order_number)

        
async def request_product_availability(data):
    product_code = data.get('data', {}).get('productCode')
    if product_code:
        await send_message_to_bot(f"@{BOT_USERNAME} /Наличие№Т-{product_code}/")
    else:
        print("Обработчик заказов: Ошибка - отсутствует productCode.")

# ----------- Запуск -----------
async def main():
    await client.start()
    
    print("Запуск: Telegram клиент запущен")
    try:
        await asyncio.gather(
            websocket_listener(),
            client.run_until_disconnected()
        )
    except Exception as e:
        print(f"Запуск: ГЛАВНАЯ ОШИБКА: {e}")

if __name__ == "__main__":
    asyncio.run(main())
