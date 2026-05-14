'use strict';

const state = {
  lang: localStorage.getItem('vshokolade_lang') || 'ru',
  cart: loadStoredCart(),
  pendingItemId: null,
  imagePreviewItemId: null,
  catalogLoadedFromRemote: false,
  sectionsByTab: {
    catalog: [],
    boxes: [],
    dubai: []
  },
  itemsById: new Map()
};

function init() {
  bindStaticEvents();
  initTabs();
  initPhoneMask();
  initModalOverlayClose();
  applyLanguage(state.lang, false);
  loadCatalog().then(() => {
    renderAllDynamicContent();
    updateCartUI();
    refreshOpenModals();
  }).catch((error) => {
    console.error('Catalog load error:', error);
    renderAllDynamicContent();
    updateCartUI();
  });
}

function loadStoredCart() {
  try {
    const saved = JSON.parse(localStorage.getItem('vshokolade_cart') || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveCart() {
  localStorage.setItem('vshokolade_cart', JSON.stringify(state.cart));
}

function bindStaticEvents() {
  document.querySelectorAll('.lang-switch__btn').forEach((button) => {
    button.addEventListener('click', () => applyLanguage(button.dataset.lang || 'ru', true));
  });

  const heroButton = document.getElementById('hero-catalog-btn');
  if (heroButton) {
    heroButton.addEventListener('click', (event) => {
      event.preventDefault();
      activateTab('catalog', false);
      scrollToCatalog();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeCart();
      closeOrder();
      closeSuccess();
      closeImagePreview();
    }
  });
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach((button) => {
    button.addEventListener('click', () => {
      activateTab(button.dataset.tab || 'catalog', true);
    });
  });
}

function activateTab(tab, shouldScroll) {
  document.querySelectorAll('.tab-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });

  document.querySelectorAll('.tab-section').forEach((section) => {
    section.classList.toggle('active', section.id === `tab-${tab}`);
  });

  if (shouldScroll) {
    const nav = document.getElementById('tabs-nav');
    if (nav) nav.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function scrollToCatalog() {
  const target = document.querySelector('#tab-catalog .section-label') || document.getElementById('tabs-nav');
  const nav = document.getElementById('tabs-nav');
  if (!target) return;
  const offset = (nav ? nav.offsetHeight : 0) + 12;
  const top = target.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: 'smooth' });
}

function initPhoneMask() {
  const phoneInput = document.getElementById('input-phone');
  if (!phoneInput) return;

  const sanitizePhoneValue = (value) => {
    const raw = String(value || '').trim();
    const hasPlus = raw.startsWith('+');
    const digits = raw.replace(/\D/g, '').slice(0, 15);

    if (!digits) return hasPlus ? '+' : '';
    return hasPlus ? `+${digits}` : digits;
  };

  phoneInput.addEventListener('input', function onInput() {
    this.value = sanitizePhoneValue(this.value);
  });

  phoneInput.addEventListener('blur', function onBlur() {
    const formatted = formatPhoneForDisplay(this.value);
    if (formatted) this.value = formatted;
  });
}

function initModalOverlayClose() {
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (event) => {
      if (event.target !== overlay) return;
      if (overlay.id === 'cart-modal') closeCart();
      if (overlay.id === 'order-modal') closeOrder();
      if (overlay.id === 'success-modal') closeSuccess();
      if (overlay.id === 'image-modal') closeImagePreview();
    });
  });
}

async function loadCatalog() {
  const source = window.CATALOG_SOURCE || {};
  const remoteUrl = (source.googleSheetCsvUrl || '').trim();
  const localUrls = [
    (source.localCsvUrl || '').trim(),
    ...((Array.isArray(source.localFallbackUrls) ? source.localFallbackUrls : []).map((url) => (url || '').trim()))
  ].filter(Boolean);

  let csvText = '';
  let lastLocalError = null;

  for (const url of (localUrls.length ? localUrls : ['data/products.csv', 'data/products.tsv'])) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Local source failed with ${response.status}`);
      csvText = await response.text();
      state.catalogLoadedFromRemote = false;
      break;
    } catch (error) {
      lastLocalError = error;
      console.warn(`Catalog source not available: ${url}`, error);
    }
  }

  if (!csvText && remoteUrl) {
    try {
      const response = await fetch(remoteUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Remote source failed with ${response.status}`);
      csvText = await response.text();
      state.catalogLoadedFromRemote = true;
      showToast(getText('messages.sourceLoaded'));
    } catch (error) {
      console.warn('Remote catalog failed:', error);
    }
  }

  if (!csvText) throw lastLocalError || new Error('No catalog source available');

  const rows = parseCsv(csvText);
  buildCatalogState(rows);
}

function parseCsv(csvText) {
  const rows = [];
  const firstLine = (csvText.split(/\r?\n/).find((line) => line.trim()) || '');
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(current);
      current = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else {
      current += char;
    }
  }

  if (current.length || row.length) {
    row.push(current);
    if (row.some((cell) => cell !== '')) rows.push(row);
  }

  const [header = [], ...dataRows] = rows;
  return dataRows.map((cells) => {
    const record = {};
    header.forEach((key, index) => {
      record[key] = (cells[index] || '').trim();
    });
    return record;
  });
}

function buildCatalogState(rows) {
  const sectionsByTab = { catalog: [], boxes: [], dubai: [] };
  const sectionMap = new Map();
  state.itemsById = new Map();

  rows.forEach((row) => {
    const item = {
      id: row.id,
      tab: row.tab,
      sectionId: row.section_id,
      sectionIcon: row.section_icon,
      sectionTitle: { ru: row.section_title_ru, kz: row.section_title_kz },
      sectionSubtitle: { ru: row.section_sub_ru, kz: row.section_sub_kz },
      cardType: row.card_type,
      name: { ru: row.name_ru, kz: row.name_kz },
      description: { ru: row.description_ru, kz: row.description_kz },
      price: Number(row.price || 0),
      qty: { ru: row.qty_ru, kz: row.qty_kz },
      badge: { ru: row.badge_ru, kz: row.badge_kz },
      emoji: row.emoji,
      image: normalizeImageUrl(row.image)
    };

    if (!item.id || !item.tab || !sectionsByTab[item.tab]) return;
    state.itemsById.set(item.id, item);

    const sectionKey = `${item.tab}::${item.sectionId}`;
    if (!sectionMap.has(sectionKey)) {
      const section = {
        id: item.sectionId,
        icon: item.sectionIcon,
        title: item.sectionTitle,
        subtitle: item.sectionSubtitle,
        cardType: item.cardType,
        items: []
      };
      sectionMap.set(sectionKey, section);
      sectionsByTab[item.tab].push(section);
    }

    sectionMap.get(sectionKey).items.push(item);
  });

  state.sectionsByTab = sectionsByTab;
}

function applyLanguage(lang, savePreference = true) {
  state.lang = lang === 'kz' ? 'kz' : 'ru';
  document.documentElement.lang = state.lang === 'kz' ? 'kk' : 'ru';
  if (savePreference) localStorage.setItem('vshokolade_lang', state.lang);

  document.querySelectorAll('.lang-switch__btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.lang === state.lang);
  });

  applyStaticTranslations();
  renderHeroArea();
  renderAllDynamicContent();
  updateCartUI();
  refreshOpenModals();
}

function applyStaticTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = getText(node.dataset.i18n);
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.setAttribute('placeholder', getText(node.dataset.i18nPlaceholder));
  });

  const topbarButton = document.getElementById('cart-topbar-btn');
  if (topbarButton) topbarButton.textContent = getText('cart.topbarBtn');

  const footerAddress = document.getElementById('footer-address');
  const footerTagline = document.getElementById('footer-tagline');
  if (footerAddress) footerAddress.textContent = localized(window.SITE_CONTENT.footer.address);
  if (footerTagline) footerTagline.textContent = localized(window.SITE_CONTENT.footer.tagline);
}

function renderHeroArea() {
  const heroSubtitle = document.getElementById('hero-subtitle');
  const heroButton = document.getElementById('hero-catalog-btn');
  const heroBadges = document.getElementById('hero-badges');

  if (heroSubtitle) heroSubtitle.innerHTML = localized(window.SITE_CONTENT.hero.subtitle);
  if (heroButton) heroButton.textContent = getText('hero.cta');
  if (heroBadges) {
    heroBadges.innerHTML = window.SITE_CONTENT.hero.badges.map((badge) => `
      <span class="badge"><i class="${badge.icon}"></i> ${escapeHtml(localized(badge))}</span>
    `).join('');
  }
}

function renderAllDynamicContent() {
  renderCatalogTab();
  renderSpecialTab();
  renderDubaiTab();
  renderInfoTab();
}

function renderCatalogTab() {
  const container = document.getElementById('catalog-content');
  if (!container) return;
  container.innerHTML = state.sectionsByTab.catalog.map(renderSection).join('');
}

function renderSpecialTab() {
  const container = document.getElementById('special-content');
  if (!container) return;
  container.innerHTML = state.sectionsByTab.boxes.map((section) => `
    ${renderSectionLabel(section)}
    <div class="products-list">
      ${section.items.map(renderProductCard).join('')}
    </div>
  `).join('');
}

function renderDubaiTab() {
  const container = document.getElementById('dubai-content');
  if (!container) return;
  const section = state.sectionsByTab.dubai[0];
  if (!section) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    ${renderSectionLabel(section)}
    <div class="dubai-hero-card">
      <div class="dubai-hero-card__icon">🍫</div>
      <h3 class="dubai-hero-card__title">${escapeHtml(localized(window.SITE_CONTENT.dubaiHero.title))}</h3>
      <p class="dubai-hero-card__desc">${window.SITE_CONTENT.dubaiHero.desc[state.lang]}</p>
    </div>
    <div class="dubai-grid">
      ${section.items.map(renderDubaiCard).join('')}
    </div>
  `;
}

function renderInfoTab() {
  const container = document.getElementById('info-content');
  if (!container) return;
  container.innerHTML = window.SITE_CONTENT.infoBlocks.map((block) => {
    const paragraphs = (block.body?.[state.lang] || []).map((text) => `<p>${text}</p>`).join('');
    const address = block.address ? `
      <div class="info-address">
        <i class="fas fa-map-marker-alt"></i>
        <span>${block.address[state.lang]}</span>
      </div>
    ` : '';
    const hours = block.hours ? `
      <div class="info-hours">
        <i class="fas fa-clock"></i>
        <span>${block.hours[state.lang]}</span>
      </div>
    ` : '';
    const note = block.note ? `<p class="info-note">${block.note[state.lang]}</p>` : '';
    const timeline = block.timeline ? `
      <div class="time-list">
        ${block.timeline.map((item) => `
          <div class="time-item">
            <span class="time-item__label">${escapeHtml(localized(item.label))}</span>
            <span class="time-item__value">${escapeHtml(localized(item.value))}</span>
          </div>
        `).join('')}
      </div>
    ` : '';
    const tips = block.tips ? block.tips.map((tip) => `
      <div class="storage-tip ${tip.className}">
        <i class="${tip.iconClass}"></i>
        <span>${tip.text[state.lang]}</span>
      </div>
    `).join('') : '';
    const intro = block.intro ? `<p>${block.intro[state.lang]}</p>` : '';
    const perks = block.perks ? `
      <div class="delivery-perks">
        ${block.perks.map((perk) => `
          <div class="delivery-perk">
            <i class="${perk.iconClass}"></i>
            <span>${escapeHtml(localized(perk.text))}</span>
          </div>
        `).join('')}
      </div>
    ` : '';

    return `
      <div class="info-block">
        <div class="info-block__header">
          <span class="info-block__icon">${block.icon}</span>
          <h3 class="info-block__title">${escapeHtml(localized(block.title))}</h3>
        </div>
        <div class="info-block__body">
          ${paragraphs}
          ${address}
          ${hours}
          ${timeline}
          ${tips}
          ${intro}
          ${perks}
          ${note}
        </div>
      </div>
    `;
  }).join('');
}

function renderSection(section) {
  if (section.cardType === 'addition') {
    return `
      ${renderSectionLabel(section)}
      <div class="additions-grid">
        ${section.items.map(renderAdditionCard).join('')}
      </div>
    `;
  }

  return `
    ${renderSectionLabel(section)}
    <div class="price-grid">
      ${section.items.map(renderPriceCard).join('')}
    </div>
  `;
}

function renderSectionLabel(section) {
  return `
    <div class="section-label">
      <span class="section-label__icon">${escapeHtml(section.icon || '🍓')}</span>
      <div>
        <h2 class="section-label__title">${escapeHtml(localized(section.title))}</h2>
        <p class="section-label__sub">${escapeHtml(localized(section.subtitle))}</p>
      </div>
    </div>
  `;
}

function renderItemMedia(item, options = {}) {
  const {
    wrapperClass = '',
    imageClass = '',
    fallbackClass = '',
    fallbackValue = item.emoji || '🍓'
  } = options;

  if (item.image) {
    return `
      <button class="card-media ${wrapperClass} is-image" type="button" onclick="return openImagePreviewById(event, '${item.id}')" aria-label="${escapeAttribute(localized(item.name) || 'Preview')}">
        <img src="${escapeAttribute(item.image)}" alt="${escapeAttribute(localized(item.name))}" class="${imageClass}" loading="lazy" />
        <span class="card-media__zoom"><i class="fas fa-expand"></i></span>
      </button>
    `;
  }

  return `
    <div class="card-media ${wrapperClass}">
      <span class="${fallbackClass}">${escapeHtml(fallbackValue)}</span>
    </div>
  `;
}

function renderPriceCard(item) {
  const badge = item.badge[state.lang] ? `<div class="price-card__badge">${escapeHtml(item.badge[state.lang])}</div>` : '';
  return `
    <div class="price-card${badge ? ' popular' : ''}">
      ${badge}
      ${renderItemMedia(item, {
        wrapperClass: 'price-card__media',
        imageClass: 'price-card__thumb',
        fallbackClass: 'price-card__emoji',
        fallbackValue: item.emoji || '🍓'
      })}
      <div class="price-card__qty">${escapeHtml(localized(item.qty))}</div>
      <div class="price-card__price">${formatPrice(item.price)}</div>
      <button class="btn-add-small" type="button" onclick="addToCart('${item.id}')">${escapeHtml(getText('buttons.addSmall'))}</button>
    </div>
  `;
}

function renderAdditionCard(item) {
  return `
    <div class="addition-item" onclick="addToCart('${item.id}')">
      ${renderItemMedia(item, {
        wrapperClass: 'addition-item__media',
        imageClass: 'addition-item__thumb',
        fallbackClass: 'addition-item__icon',
        fallbackValue: item.emoji || '✨'
      })}
      <span class="addition-item__name">${escapeHtml(localized(item.name))}</span>
      <span class="addition-item__price">${formatPrice(item.price)}</span>
      <span class="addition-item__plus">+</span>
    </div>
  `;
}

function renderProductCard(item) {
  const badge = item.badge[state.lang] ? `<div class="product-card__tag">${escapeHtml(item.badge[state.lang])}</div>` : '';
  return `
    <div class="product-card">
      <div class="product-card__img-wrap">
        ${renderItemMedia(item, {
          wrapperClass: 'product-card__media',
          imageClass: 'product-card__img',
          fallbackClass: 'product-card__fallback',
          fallbackValue: item.emoji || '🍓'
        })}
        <div class="product-card__overlay">
          <button class="btn-want" type="button" onclick="wantThis('${item.id}')">${escapeHtml(getText('buttons.want'))}</button>
        </div>
      </div>
      <div class="product-card__body">
        ${badge}
        <h3 class="product-card__name">${escapeHtml(localized(item.name))}</h3>
        <p class="product-card__desc">${escapeHtml(localized(item.description))}</p>
        <div class="product-card__footer">
          <span class="product-card__price">${formatPrice(item.price)}</span>
          <button class="btn-add" type="button" onclick="addToCart('${item.id}')">${escapeHtml(getText('buttons.add'))}</button>
        </div>
      </div>
    </div>
  `;
}

function renderDubaiCard(item) {
  const badge = item.badge[state.lang] ? `<div class="dubai-card__badge">${escapeHtml(item.badge[state.lang])}</div>` : '';
  const premiumClass = item.badge[state.lang] === 'Premium' ? ' premium' : '';
  const popularClass = badge && !premiumClass ? ' popular' : '';

  return `
    <div class="dubai-card${popularClass}${premiumClass}" onclick="addToCart('${item.id}')">
      ${badge}
      ${renderItemMedia(item, {
        wrapperClass: 'dubai-card__media',
        imageClass: 'dubai-card__thumb',
        fallbackClass: 'dubai-card__size',
        fallbackValue: item.emoji || '🍫'
      })}
      <div class="dubai-card__weight">${escapeHtml(localized(item.qty))}</div>
      <div class="dubai-card__price">${formatPrice(item.price)}</div>
      <div class="dubai-card__btn">${escapeHtml(getText('buttons.addSmall'))}</div>
    </div>
  `;
}

window.addToCart = function addToCart(itemId) {
  const item = state.itemsById.get(itemId);
  if (!item) return;

  const existing = state.cart.find((cartItem) => cartItem.id === itemId);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({
      id: item.id,
      qty: 1,
      price: item.price,
      name: item.name
    });
  }

  saveCart();
  updateCartUI();
  refreshOpenModals();
  showToast(getText('messages.added'));
};

window.removeFromCart = function removeFromCart(itemId) {
  state.cart = state.cart.filter((item) => item.id !== itemId);
  saveCart();
  updateCartUI();
  renderCartItems();
  renderOrderSummary();
};

function updateCartUI() {
  const totalItems = state.cart.reduce((sum, item) => sum + item.qty, 0);
  const fab = document.getElementById('fab-cart');
  const fabCount = document.getElementById('fab-count');
  const topbar = document.getElementById('cart-topbar');
  const topbarText = document.getElementById('cart-topbar-text');

  if (fab) fab.style.display = totalItems ? 'flex' : 'none';
  if (fabCount) fabCount.textContent = String(totalItems);
  if (topbar) topbar.style.display = totalItems ? 'flex' : 'none';
  if (topbarText) {
    topbarText.innerHTML = getText('cart.topbar').replace('{count}', String(totalItems));
  }
}

function renderCartItems() {
  const container = document.getElementById('cart-items');
  const empty = document.getElementById('cart-empty');
  const footer = document.getElementById('cart-footer');
  const totalBlock = document.getElementById('cart-total');
  const totalPrice = document.getElementById('total-price');
  if (!container || !empty || !footer || !totalBlock || !totalPrice) return;

  if (!state.cart.length) {
    container.innerHTML = '';
    empty.style.display = 'block';
    footer.style.display = 'none';
    totalBlock.style.display = 'none';
    return;
  }

  container.innerHTML = state.cart.map((item) => `
    <div class="cart-item">
      <div class="cart-item__name">${escapeHtml(localized(item.name))} × ${item.qty}</div>
      <div class="cart-item__price">${formatPrice(item.price * item.qty)}</div>
      <button class="cart-item__remove" type="button" onclick="removeFromCart('${item.id}')">×</button>
    </div>
  `).join('');

  empty.style.display = 'none';
  footer.style.display = 'block';
  totalBlock.style.display = 'flex';
  totalPrice.textContent = formatPrice(getCurrentItems().reduce((sum, item) => sum + item.price * item.qty, 0));
}

window.openCart = function openCart() {
  renderCartItems();
  toggleModal('cart-modal', true);
};

window.closeCart = function closeCart() {
  toggleModal('cart-modal', false);
};

window.openOrder = function openOrder() {
  if (!state.pendingItemId && !state.cart.length) {
    showToast(getText('order.cartRequired'));
    return;
  }
  closeCart();
  renderOrderSummary();
  toggleModal('order-modal', true);
};

window.closeOrder = function closeOrder() {
  toggleModal('order-modal', false);
};

window.wantThis = function wantThis(itemId) {
  state.pendingItemId = itemId;
  renderOrderSummary();
  toggleModal('order-modal', true);
  showToast(getText('order.quickAdded'));
};

function renderOrderSummary() {
  const title = document.getElementById('order-product-name');
  const summary = document.getElementById('order-summary');
  if (!title || !summary) return;

  if (state.pendingItemId) {
    const item = state.itemsById.get(state.pendingItemId);
    title.textContent = item ? localized(item.name) : getText('order.itemSub');
  } else {
    title.textContent = getText('order.cartSub');
  }

  const items = getCurrentItems();
  if (!items.length) {
    summary.innerHTML = '';
    return;
  }

  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  summary.innerHTML = `
    <strong>${escapeHtml(getText('order.summaryTitle'))}</strong><br />
    ${items.map((item) => escapeHtml(getText('order.summaryLine').replace('{name}', localized(item.name)).replace('{qty}', item.qty))).join('<br />')}
    <br /><br />
    <strong>${escapeHtml(getText('order.total'))}: ${formatPrice(total)}</strong>
  `;
}

window.submitOrder = async function submitOrder(event) {
  event.preventDefault();
  const name = document.getElementById('input-name')?.value.trim() || '';
  const phoneRaw = document.getElementById('input-phone')?.value.trim() || '';
  const comment = document.getElementById('input-comment')?.value.trim() || '';

  if (!name || !phoneRaw) return;

  const items = getCurrentItems();
  if (!items.length) return;

  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const itemsText = items.map((item) => `${localized(item.name)} (${item.qty} ${getText('labels.qtyUnit')})`).join(', ');
  const clientPhoneClean = normalizePhone(phoneRaw);
  const phone = formatPhoneForDisplay(phoneRaw) || phoneRaw;
  const customerText = state.lang === 'kz'
    ? `Сәлеметсіз бе! Vshokolade сайтынан тапсырыс.\n👤 Аты: ${name}\n🍓 Тапсырыс: ${itemsText}\n💰 Сома: ${formatPrice(total)}\n💬 Пікір: ${comment || '-'}`
    : `Здравствуйте! Заказ с сайта Vshokolade.\n👤 Имя: ${name}\n🍓 Заказ: ${itemsText}\n💰 Сумма: ${formatPrice(total)}\n💬 Коммент: ${comment || '-'}`;

  const customerLink = `https://wa.me/${window.SITE_CONTENT.whatsappNumber}?text=${encodeURIComponent(customerText)}`;
  const operatorLink = clientPhoneClean ? `https://wa.me/${clientPhoneClean}` : '';

  try {
    await fetch(window.SITE_CONTENT.bitrixUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          TITLE: `Заказ: ${name} (Сайт Vshokolade)`,
          NAME: name,
          PHONE: [{ VALUE: phone, VALUE_TYPE: 'WORK' }],
          OPPORTUNITY: total,
          CURRENCY_ID: 'KZT',
          STAGE_ID: 'PREPARATION',
          COMMENTS: `Состав: ${itemsText}\n\nКомментарий: ${comment || '-'}`,
          [window.SITE_CONTENT.bitrixFields.composition]: itemsText,
          [window.SITE_CONTENT.bitrixFields.clientWhatsapp]: operatorLink
        }
      })
    });
  } catch (error) {
    console.error('Bitrix error:', error);
  }

  const successText = document.getElementById('success-text');
  const successPhone = document.getElementById('success-phone');
  const waButton = document.getElementById('wa-confirm-btn');
  if (successText) {
    successText.innerHTML = getText('success.text').replace('{name}', escapeHtml(name));
  }
  if (successPhone) successPhone.textContent = phone;
  if (waButton) waButton.href = customerLink;

  toggleModal('order-modal', false);
  toggleModal('success-modal', true);

  if (!state.pendingItemId) {
    state.cart = [];
    saveCart();
  }
  state.pendingItemId = null;
  document.getElementById('order-form')?.reset();
  updateCartUI();
  renderCartItems();
  renderOrderSummary();
  showToast(getText('messages.openWhatsApp'));
  triggerWhatsApp(customerLink, customerText);
};

function triggerWhatsApp(customerLink, customerText) {
  const phone = window.SITE_CONTENT.whatsappNumber;
  const deepLink = `whatsapp://send?phone=${phone}&text=${encodeURIComponent(customerText)}`;

  if (isMobileDevice()) {
    setTimeout(() => {
      window.location.href = deepLink;
      setTimeout(() => {
        if (document.visibilityState === 'visible') {
          window.location.href = customerLink;
        }
      }, 1200);
    }, 300);
    return;
  }

  setTimeout(() => {
    const popup = window.open(customerLink, '_blank', 'noopener,noreferrer');
    if (!popup) window.location.href = customerLink;
  }, 300);
}

window.closeSuccess = function closeSuccess() {
  toggleModal('success-modal', false);
};

window.openImagePreviewById = function openImagePreviewById(eventOrItemId, maybeItemId) {
  const event = maybeItemId ? eventOrItemId : null;
  const itemId = maybeItemId || eventOrItemId;
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const item = state.itemsById.get(itemId);
  if (!item || !item.image) return false;

  state.imagePreviewItemId = itemId;
  renderImagePreview();
  toggleModal('image-modal', true);
  return false;
};

window.closeImagePreview = function closeImagePreview() {
  state.imagePreviewItemId = null;
  toggleModal('image-modal', false);
};

function renderImagePreview() {
  const image = document.getElementById('image-preview-img');
  const caption = document.getElementById('image-preview-caption');
  const item = state.imagePreviewItemId ? state.itemsById.get(state.imagePreviewItemId) : null;

  if (!image || !caption || !item) return;

  image.src = item.image;
  image.alt = localized(item.name);
  caption.textContent = localized(item.name);
}

function toggleModal(id, show) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.style.display = show ? 'flex' : 'none';
  document.body.style.overflow = show ? 'hidden' : '';
}

function refreshOpenModals() {
  if (document.getElementById('cart-modal')?.style.display === 'flex') renderCartItems();
  if (document.getElementById('order-modal')?.style.display === 'flex') renderOrderSummary();
  if (document.getElementById('image-modal')?.style.display === 'flex') renderImagePreview();
}

function getCurrentItems() {
  if (state.pendingItemId) {
    const item = state.itemsById.get(state.pendingItemId);
    return item ? [{ id: item.id, qty: 1, price: item.price, name: item.name }] : [];
  }
  return state.cart;
}

function normalizePhone(value) {
  let digits = (value || '').replace(/\D/g, '');
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits;
}

function formatPhoneForDisplay(value) {
  const raw = String(value || '').trim();
  const digits = normalizePhone(raw);

  if (!digits) return '';
  if (digits.startsWith('7') && digits.length === 11) {
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }

  return raw.startsWith('+') ? `+${digits}` : digits;
}

function normalizeImageUrl(value) {
  return String(value || '').trim();
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

function localized(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value[state.lang] || value.ru || '';
}

function getText(path) {
  const parts = path.split('.');
  let current = window.SITE_CONTENT?.i18n?.[state.lang];
  parts.forEach((part) => {
    if (current) current = current[part];
  });
  return current || path;
}

function formatPrice(value) {
  return `${Number(value || 0).toLocaleString('ru-RU')} ₸`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function showToast(message) {
  let toast = document.getElementById('global-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'global-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
