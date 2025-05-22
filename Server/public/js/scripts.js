const tg = window.Telegram.WebApp;
tg.expand();

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

// Проверка параметра orderNumber в адресной строке
const urlParams = new URLSearchParams(window.location.search);
const orderNumber = urlParams.get('orderNumber');
let token = urlParams.get('token');

// Массив для хранения товаров
let pendingDeleteCode = null;
const scannedItems = [];
const userChatId = tg.initDataUnsafe?.user?.id || null;

// Количество товаров для удаления при редактировании
let deletetotalQuantity = 0;

// Функция для добавления CSS файла
function addCSSFile(href) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

// Если токен найден, сохраняем его в localStorage
if (token) {
  localStorage.setItem('jwt', token);
  alert('Сохранён токен:\n' + token);
}

if (orderNumber) {

  // Изменение заголовка и текста кнопки
  header.textContent = `Изменение заказа: ${orderNumber}`;
  orderBtn.textContent = `Редактировать`;
  
  // Изменение цвета кнопки на синий
  orderBtn.classList.remove('bg-green-600', 'hover:bg-green-700');
  orderBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
  
  // Подключение CSS файла
  addCSSFile('/css/pepe.css?42');
  
  // Убираем свойство display
  speechBubble.style.removeProperty('display');
  
  // Добавляем кнопку "Удалить заказ"
  const deleteOrderBtn = document.createElement('button');
  deleteOrderBtn.textContent = 'Удалить заказ';
  deleteOrderBtn.className = 'flex-1 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 transition';
  deleteOrderBtn.addEventListener('click', () => {
    if (confirm('Вы уверены, что хотите удалить заказ?')) {
        
      const payload = {
        chatId: userChatId,
        type: 'delete_order',
        orderNumber: orderNumber
      };

      fetch('/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jwt')}`
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
        addOrUpdateCard(item.code, item.price);
        
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
      console.error('Не удалось загрузить товары заказа:', err);
      alert('Ошибка загрузки данных заказа');
    });
}


// Слушаем нажатие кнопок для добавления товаров
document.getElementById('bagBtn').addEventListener('click', () => addOrUpdateCard('000029690', '1'));
document.getElementById('suitcaseBtn').addEventListener('click', () => addOrUpdateCard('000029691', '2'));

// Сканирование QR-кода
scanBtn.addEventListener('click', () => {
  if (!tg.showScanQrPopup || !tg.closeScanQrPopup) {
    alert('QR сканер не поддерживается');
    return;
  }

  tg.showScanQrPopup({ text: 'Сканируйте QR-код' });

  tg.onEvent('qrTextReceived', function handler(data) {
    tg.closeScanQrPopup();
    tg.offEvent('qrTextReceived', handler);

    const qrText = data.data;
    processScannedQR(qrText);
  });
});

// Обработка сканированного QR-кода
function processScannedQR(qrText) {
  if (/^\d+$/.test(qrText)) {
    window.location.href = `https://order.warflame.net/?orderNumber=${qrText}`;
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
      addOrUpdateCard('Ошибка', 'Данные не найдены');
    }
  } else {
    addOrUpdateCard('Недопустимый домен', '');
  }
}

// Оформление заказа
orderBtn.addEventListener('click', async () => {
  if (scannedItems.length === 0) return alert('Список пуст');
  
  let payload;
  
    if (orderNumber) {
        payload = {
            chatId: userChatId,
            type: 'edit_order',
            orderNumber: orderNumber,
            totalQuantity: deletetotalQuantity,
            data: scannedItems.map((item, index) => ({
                cardNumber: index + 1,
                code: item.code,
                price: item.price,
                quantity: item.quantity
                })),
            };
        } else {
        payload = {
            chatId: userChatId,
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
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('jwt')}`  // Здесь добавляем токен
      },
      body: JSON.stringify(payload),
    });

    tg.close();
  } catch (err) {
    alert('Ошибка отправки заказа');
    console.error(err);
  }
});

// Модалки и обработчики
clearBtn.addEventListener('click', () => confirmDeleteModal.classList.remove('hidden'));
confirmDeleteYes.addEventListener('click', () => clearCart());
confirmDeleteNo.addEventListener('click', () => confirmDeleteModal.classList.add('hidden'));
confirmYes.addEventListener('click', () => deleteItem());
confirmNo.addEventListener('click', () => cancelDeletion());

// Закрытие модалки с информацией о товаре
closeInfoModal.addEventListener('click', () => infoModal.classList.add('hidden'));

// Очистка корзины
function clearCart() {
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
      console.error(`Попытка ${attempts} не удалась: ${error.message}`);
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
function addOrUpdateCard(code, price) {
  let item = scannedItems.find(item => item.code === code);

  if (item) {
    item.quantity += 1;
    document.getElementById(`quantity-${code}`).value = item.quantity;
  } else {
    fetch('/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('jwt')}`  // Здесь добавляем токен
      },
      body: JSON.stringify({
        chatId: userChatId,
        type: 'name',
        data: { productCode: code },
      }),
    }).catch(console.error);

    const quantity = 1;
    scannedItems.push({ code, price, quantity });

    const card = createCardElement(code, price);
    cardList.appendChild(card);

    fetchProductDetails(code);

    card.addEventListener('click', async (e) => {
      if (!e.target.closest('button')) {
        infoModal.classList.remove('hidden');
        await fetchProductDetails(code);
      }
    });

    const minusBtn = card.querySelector('[data-action="minus"]');
    const plusBtn = card.querySelector('[data-action="plus"]');

    minusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateQuantity(code, -1);
    });

    plusBtn.addEventListener('click', (e) => {
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
function createCardElement(code, price) {
  const card = document.createElement('div');
  card.className = 'bg-gray-800 shadow rounded-xl p-4 border border-gray-700 flex flex-col space-y-2 cursor-pointer z-1;';
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
        <p><strong>Код:</strong> ${code}</p>
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

  totalLine.innerHTML = `Итого: ${totalQuantity} шт. на ${totalPrice.toFixed(2)} руб.`;
}