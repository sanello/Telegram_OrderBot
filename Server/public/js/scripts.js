const tg = window.Telegram.WebApp;
tg.expand();
tg.disableVerticalSwipes();

// Элементы DOM
const scanBtn = document.getElementById('scanBtn');
const orderBtn = document.getElementById('orderBtn');
const clearBtn = document.getElementById('clearBtn');
const cardList = document.getElementById('cardList');
const totalLine = document.getElementById('totalLine');
const confirmModal = document.getElementById('confirmModal');
const confirmYes = document.getElementById('confirmYes');
const confirmNo = document.getElementById('confirmNo');
const infoModal = document.getElementById('infoModal');
const closeInfoModal = document.getElementById('closeInfoModal');
const modalContent = document.getElementById('modalContent');
const confirmDeleteModal = document.getElementById('confirmDeleteModal');
const confirmDeleteYes = document.getElementById('confirmDeleteYes');
const confirmDeleteNo = document.getElementById('confirmDeleteNo');
const header = document.getElementById('orderTitle');
const speechBubble = document.getElementById('speechBubble');
const btnPlaceholder = document.getElementById('BtnPlaceholder');
const discountSpan = document.getElementById('discountInfo');
const bagBtn = document.getElementById('bagBtn');
const suitcaseBtn = document.getElementById('suitcaseBtn');
const editInput = document.getElementById('editInput');
const editBtn = document.getElementById('editBtn');
const editOrderBtn = document.getElementById('editOrderBtn');
const addItemBtn = document.getElementById('addItemBtn');

// Проверка параметра orderNumber в адресной строке
const urlParams = new URLSearchParams(window.location.search);
const orderNumber = urlParams.get('orderNumber');

// Массив для хранения товаров
let pendingDeleteCode = null;
const scannedItems = [];

// Количество товаров для удаления при редактировании
let deletetotalQuantity = 0;

// Функция для добавления CSS файла
function addCSSFile(href) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

if (orderNumber) {

  // Изменение заголовка и текста кнопки
  header.textContent = `Изменение заказа: ${orderNumber}`;
  orderBtn.textContent = `Редактировать`;
  
  // Изменение цвета кнопки на синий
  orderBtn.classList.remove('bg-green-600', 'hover:bg-green-700');
  orderBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
  
  // Подключение CSS файла
  addCSSFile('/css/pepe.css?1.2');
  
  // Убираем свойство display
  speechBubble.style.removeProperty('display');
  
  // Добавляем кнопку "Удалить заказ"
  const deleteOrderBtn = document.createElement('button');
  deleteOrderBtn.textContent = 'Удалить заказ';
  deleteOrderBtn.className = 'flex-1 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 transition';
  deleteOrderBtn.addEventListener('click', () => {
    tg.HapticFeedback.impactOccurred('light');
    if (confirm('Вы уверены, что хотите удалить заказ?')) {
      tg.HapticFeedback.impactOccurred('light');
      const payload = {
        initData: tg.initData,
        type: 'delete_order',
        orderNumber: orderNumber
      };

      fetch('/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
      
      tg.close();
      
    }
  });
  
  // Вставляем кнопку удаления в интерфейс
  btnPlaceholder.appendChild(deleteOrderBtn);
  clearBtn.remove();
  
  // Загружаем товары заказа
  fetch(`/order-items?orderNumber=${orderNumber}`)
    .then(response => {
      if (!response.ok) throw new Error('Ошибка при получении данных заказа');
      return response.json();
    })
    .then(items => {
      items.forEach(item => {
        // Добавляем товар в корзину с его ценой
        addOrUpdateCard(item.code, item.price, false);
        
        // Определяем количество уникальных товаров для удаления при редактировании
        if (item.cardNumber && item.cardNumber > deletetotalQuantity) {
            deletetotalQuantity = item.cardNumber;
        }

        // Обновляем количество товара на основе ответа
        const cardItem = scannedItems.find(el => el.code === item.code);
        if (cardItem) {
          cardItem.quantity = item.quantity;
          const quantityInput = document.getElementById(`quantity-${item.code}`);
          if (quantityInput) quantityInput.value = item.quantity;
        }
      });
      updateTotal();
    })
    .catch(err => {
      alert('Ошибка загрузки данных заказа');
    });
} else {
  // Запуск сканера при старте
  window.addEventListener('DOMContentLoaded', () => {
    tg.HapticFeedback.impactOccurred('medium');
    startQRScanOnce();
  });
}

// Слушаем нажатие кнопок для добавления товаров
bagBtn.addEventListener('click', () => {
  tg.HapticFeedback.impactOccurred('light');
  addOrUpdateCard('000029690', '1');
});
suitcaseBtn.addEventListener('click', () => {
  tg.HapticFeedback.impactOccurred('light');
  addOrUpdateCard('000029691', '2');
});

// Кнопка ручного ввода кода товара или номера заказа
editBtn.addEventListener('click', () => {
  tg.HapticFeedback.impactOccurred('light');
  
  editModal.classList.remove('hidden');
  
  // фокус на поле ввода
  document.getElementById("editInput").focus();
});

// Редактирование заказа (ручной ввод)
editOrderBtn.addEventListener('click', () => {
  tg.HapticFeedback.impactOccurred('light');
  
  let editOrderinputValue = editInput.value.trim(); // удаляет пробелы в начале и конце
  if (!editOrderinputValue) return; // проверка на пустоту

  window.location.href = `https://order.warflame.net/?orderNumber=${encodeURIComponent(editOrderinputValue)}`;
  
  return;
});

// Добавить товар по коду (ручной ввод)
addItemBtn.addEventListener('click', () => {
  tg.HapticFeedback.impactOccurred('light');
  
  let productCodeinputValue = editInput.value.trim(); // удаляет пробелы в начале и конце
  if (!productCodeinputValue) return; // проверка на пустоту
  
  // Добавляем ведущие нули до 9 символов
  productCodeinputValue = productCodeinputValue.padStart(9, '0');
  
  addOrUpdateCard(productCodeinputValue, "0");
  
  editModal.classList.add('hidden');
  
  // очистка поля ввода
  editInput.value = '';

  return;
});

function playBeep() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.type = 'triangle';      // Тип волны, можно 'sine', 'square', 'triangle', 'sawtooth'
  oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime); // Частота звука в Гц (1000 — 1 кГц)

  gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime); // Громкость (0.1 — тихо)

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  oscillator.start();
  oscillator.stop(audioCtx.currentTime + 0.1); // Звук длится 0.1 секунды
}

// Сканирование QR-кода
function startQRScanOnce() {

  if (!tg.showScanQrPopup || !tg.closeScanQrPopup) {
    alert('QR сканер не поддерживается');
    return;
  }

  tg.showScanQrPopup({ text: 'Сканируйте QR-код' });

  tg.onEvent('qrTextReceived', function handler(data) {
    playBeep();
    tg.HapticFeedback.impactOccurred('light');
    tg.closeScanQrPopup();
    tg.offEvent('qrTextReceived', handler);

    const qrText = data.data;
    processScannedQR(qrText);
  });
}

// Повторный запуск сканера по кнопке
scanBtn.addEventListener('click', () => {
  tg.HapticFeedback.impactOccurred('light');

  startQRScanOnce();
});

// Обработка сканированного QR-кода
function processScannedQR(qrText) {
  if (/^\d+$/.test(qrText)) {
    window.location.href = `https://order.warflame.net/?orderNumber=${qrText}`;
    return;
  }
  
  const parts = qrText.split(':');
  if (parts.length >= 3 && /^\d+$/.test(parts[0])) {
    // Обновляем текст в discountInfo
    discountSpan.textContent = `Дисконт:${parts[0]}`;
    return;
  }
    
  if (qrText.startsWith('https://hi-tech.md/?')) {
    const url = new URL(qrText);
    const rawCode = url.searchParams.get('q') || '';
    const price = url.searchParams.get('price') || '';
    const productCode = rawCode.replace(/[^\d]/g, '');

    if (productCode && price) {
      addOrUpdateCard(productCode, price);
    } else {
      alert('Ошибка: Данные не найдены');
    }
  } else {
    alert('Недопустимый домен');
  }
}

// Оформление заказа
orderBtn.addEventListener('click', async () => {
  tg.HapticFeedback.impactOccurred('light');
  if (scannedItems.length === 0) return alert('Список пуст');
  
  let payload;
  
    if (orderNumber) {
        payload = {
            initData: tg.initData,
            type: 'edit_order',
            orderNumber: orderNumber,
            totalQuantity: deletetotalQuantity,
            data: scannedItems.map((item, index) => ({
                cardNumber: index + 1,
                code: item.code,
                price: item.price,
                owner: item.owner !== false,
                quantity: item.quantity
                })),
            };
        } else {
        payload = {
            initData: tg.initData,
            type: 'order',
            data: scannedItems.map((item, index) => ({
                cardNumber: index + 1,
                code: item.code,
                price: item.price,
                quantity: item.quantity
                })),
            };
    }

  try {
    await fetch('/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
    });

    tg.close();
  } catch (err) {
    alert('Ошибка отправки заказа');
  }
});

// Модалки и обработчики
clearBtn.addEventListener('click', () => {
  tg.HapticFeedback.impactOccurred('light');
  confirmDeleteModal.classList.remove('hidden');
});
confirmDeleteYes.addEventListener('click', () => {
  tg.HapticFeedback.impactOccurred('light');
  clearCart();
});
confirmDeleteNo.addEventListener('click', () => {
  tg.HapticFeedback.impactOccurred('light');
  confirmDeleteModal.classList.add('hidden');
});
confirmYes.addEventListener('click', () => {
  tg.HapticFeedback.impactOccurred('light');
  deleteItem();
});
confirmNo.addEventListener('click', () => {
  tg.HapticFeedback.impactOccurred('light');
  cancelDeletion();
});

// Закрытие модалки с информацией о товаре
closeInfoModal.addEventListener('click', () => {
  tg.HapticFeedback.impactOccurred('light');
  infoModal.classList.add('hidden');
});

// Закрытие модалки с ручного ввода кода товара или номера заказа
closeEditModal.addEventListener('click', () => {
  tg.HapticFeedback.impactOccurred('light');
  editModal.classList.add('hidden');
  editInput.value = '';
});

// Очистка корзины
function clearCart() {
  tg.HapticFeedback.impactOccurred('light');
  scannedItems.length = 0;
  cardList.innerHTML = '';
  updateTotal();
  confirmDeleteModal.classList.add('hidden');
}

// Подтвердить удаление товара
function deleteItem() {
  if (pendingDeleteCode) {
    const index = scannedItems.findIndex(item => item.code === pendingDeleteCode);
    if (index !== -1) scannedItems.splice(index, 1);
    document.getElementById(`card-${pendingDeleteCode}`).remove();
    updateTotal();
    pendingDeleteCode = null;
  }
  confirmModal.classList.add('hidden');
}

// Отмена удаления товара
function cancelDeletion() {
  confirmModal.classList.add('hidden');
  pendingDeleteCode = null;
}

// Получить подробности товара
async function fetchProductDetails(productCode) {
  const maxRetries = 5;
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      const response = await fetch(`/product-details?productCode=${productCode}`);
      if (!response.ok) throw new Error('Ошибка при получении данных с сервера');

      const data = await response.json();
      const { productName, availability } = data.data;

      if (productName) {
        updateProductCard(productCode, productName, availability);
        return;
      }

      throw new Error('Название товара не получено');
    } catch (error) {
      attempts++;
      if (attempts < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        showErrorProductDetails(productCode);
      }
    }
  }
}

// Обновить карточку товара
function updateProductCard(productCode, productName, availability) {
  document.getElementById(`name-${productCode}`).innerHTML = `<strong>${productName}</strong>`;

  availability.forEach(item => {
    if (item.store.includes("Магазин Тирасполь -2")) {
      document.getElementById(`mBtn-${productCode}`).innerHTML = `<strong>${item.quantity}</strong>`;
    }
  });

  const availabilityList = availability
    .map(item => `<li class="flex justify-between"><span class="item-label">${item.store}:</span><span class="item-value">${item.quantity}</span></li>`)
    .join('');

  modalContent.innerHTML = `
    <p class="text-lg font-semibold">${productName}</p>
    <ul class="list-disc pl-5 mt-2">
      ${availabilityList}
    </ul>
  `;
}

// Ошибка при получении данных о товаре
function showErrorProductDetails(productCode) {
  document.getElementById(`name-${productCode}`).innerHTML = `<strong>Не удалось загрузить название</strong>`;
  modalContent.innerHTML = `
    <h2 class="text-xl font-semibold">Информация о товаре</h2>
    <p>Не удалось загрузить информацию о товаре.</p>
  `;
}

// Добавить или обновить товар в корзине
function addOrUpdateCard(code, price, owner = true) {
  let item = scannedItems.find(item => item.code === code);

  if (item) {
    item.quantity += 1;
    document.getElementById(`quantity-${code}`).value = item.quantity;
  } else {
    fetch('/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        initData: tg.initData,
        type: 'name',
        data: { productCode: code },
      }),
    }).catch(console.error);

    const quantity = 1;
    scannedItems.push({ code, price, quantity, owner });

    const card = createCardElement(code, price, owner);
    cardList.appendChild(card);

    fetchProductDetails(code);

    card.addEventListener('click', async (e) => {
      tg.HapticFeedback.impactOccurred('light');
      if (!e.target.closest('button')) {
        infoModal.classList.remove('hidden');
        await fetchProductDetails(code);
      }
    });

    const minusBtn = card.querySelector('[data-action="minus"]');
    const plusBtn = card.querySelector('[data-action="plus"]');

    minusBtn.addEventListener('click', (e) => {
      tg.HapticFeedback.impactOccurred('light');
      e.stopPropagation();
      updateQuantity(code, -1);
    });

    plusBtn.addEventListener('click', (e) => {
      tg.HapticFeedback.impactOccurred('light');
      e.stopPropagation();
      updateQuantity(code, 1);
    });

    document.getElementById(`quantity-${code}`).addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        let value = parseInt(this.value, 10);
        if (isNaN(value) || value < 1) value = 1;
        updateQuantity(code, value - item?.quantity || 1);
      }
    });
  }

  updateTotal();
}

// Создание элемента карточки товара
function createCardElement(code, price, owner) {
  const card = document.createElement('div');
  
  // Базовые классы
  card.className = 'bg-gray-800 shadow rounded-xl p-4 border border-gray-700 flex flex-col space-y-2 cursor-pointer z-1;';
  
   // Если owner === false, затемняем карточку
  if (owner === false) {
    card.classList.add('opacity-40');
  }
  
  card.id = `card-${code}`;

  card.innerHTML = `
    <div class="flex justify-between items-center w-full">
        <p id="name-${code}"><strong>Загрузка...</strong></p>
        <div class="flex flex-col space-y-1 ml-auto">
            <button id="mBtn-${code}" class="bg-blue-600 text-white py-0 px-1 rounded-md text-sm">М</button>
        </div>
    </div>
    <div class="flex justify-between items-center">
      <div class="flex flex-col space-y-2">
        <p><strong>Код:</strong> ${Number(code)}</p>
        <p><strong>Цена:</strong> ${price} ₽</p>
      </div>
      <div class="flex items-center space-x-2">
        <button class="bg-red-600 text-black p-3 w-12 h-12 rounded-md font-bold" data-action="minus" data-code="${code}">-</button>
        <input type="number" id="quantity-${code}" value="1" min="1" readonly class="w-14 text-center bg-gray-700 text-white border border-gray-600 rounded">
        <button class="bg-green-600 text-black p-3 w-12 h-12 rounded-md font-bold" data-action="plus" data-code="${code}">+</button>
      </div>
    </div>
  `;

  return card;
}

// Обновить количество товара
function updateQuantity(code, delta) {
  delta = Number(delta);
  const item = scannedItems.find(item => item.code === code);
  if (!item) return;

  const newQuantity = item.quantity + delta;
  if (newQuantity > 0) {
    item.quantity = newQuantity;
    document.getElementById(`quantity-${code}`).value = newQuantity;
    updateTotal();
  } else {
    pendingDeleteCode = code;
    confirmModal.classList.remove('hidden');
  }
}

// Обновить итоговые данные
function updateTotal() {
  const totalQuantity = scannedItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = scannedItems.reduce((sum, item) => sum + item.quantity * parseFloat(item.price), 0);

  totalLine.innerHTML = `Итого: ${totalQuantity} шт. на ${totalPrice.toFixed(2)} р.`;
}
