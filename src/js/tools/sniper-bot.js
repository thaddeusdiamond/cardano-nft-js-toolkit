import {shortToast, longToast} from "./toastify-utils.js";
import {validate, validated} from "./utils.js";

const ADA_SYMBOL_HTML = '&#x20B3;';
const ADA_SYMBOL_URI = '%E2%82%B3';
const ADA_TO_LOVELACE = 1000000;
const CNFT_SNIPER_BOT_KEY = 'cnft_sniper_bot_v1';
const JPG_STORE_SEARCH = 'https://server.jpgstoreapis.com/search/tokens';
const JPG_STORE_ASSET = 'https://www.jpg.store/asset';
const NEW_TAB = "_blank";
const NOTIFICATION_TIMEOUT = 30000;
const SNIPER_INTERVAL = 5000;

var Snipes = undefined;

export function initializeSnipes() {
  var existingSnipes = localStorage.getItem(CNFT_SNIPER_BOT_KEY);
  if (!existingSnipes) {
      existingSnipes = "[]";
  }
  Snipes = JSON.parse(existingSnipes);
}

function saveSnipes() {
  localStorage.setItem(CNFT_SNIPER_BOT_KEY, JSON.stringify(Snipes));
}

export async function requestDesktopNotifications() {
  if (Notification.permission === 'granted') {
    return;
  }

  if (Notification.permission !== 'denied') {
    if ((await Notification.requestPermission()) === 'granted') {
      return;
    }
  }

  shortToast('Please enable desktop notifications for the snipers to alert your properly');
}

export function deleteSnipe(snipeId) {
  validate(confirm('Are you sure you want to delete this snipe?'));
  Snipes.splice(Snipes.findIndex(snipe => snipe.id == snipeId), 1);
  var snipeCard = document.querySelector(`#sniper-card-${snipeId}`);
  snipeCard.parentNode.removeChild(snipeCard);
  saveSnipes();
}

function addCardToDom(snipe, outputDom, deleteFunc) {
  var card = document.createElement('div');
  card.id = `sniper-card-${snipe.id}`;
  card.className = 'card col-5';

  var cardHtml =
      `<div class="card-body">
        <div class="row text-wrap">
          <span><em>Policy ID:</em> ${snipe.policyId}</span>
        </div>
        <div class="row mt-2">
          <span class="col-6"><em>Price</em> &lt; ${snipe.price / ADA_TO_LOVELACE}${ADA_SYMBOL_HTML}</span>`;
  var specifiedTraits = Object.keys(snipe.traits);
  for (var specifiedTrait of specifiedTraits) {
    cardHtml += `<span class="col-6"><em>${specifiedTrait}</em>: ${snipe.traits[specifiedTrait]}</span>`;
  }
  cardHtml +=
       `</div>
        <div class="row mt-2">
          <div class="col-6"><em>Text Alerts?</em> ${snipe.notifications.text}</div>
          <div class="col-6"><em>Desktop Alerts?</em> ${snipe.notifications.desktop}</div>
        </div>
        <div class="row mt-2">
          <input id="snipe-delete-${snipe.id}" type="submit" value="Delete" />
        </div>
      </div>`;
  card.innerHTML = cardHtml;

  document.querySelector(outputDom).appendChild(card);

  document.querySelector(`#snipe-delete-${snipe.id}`).addEventListener('click', e => {
     e && e.preventDefault();
     document.querySelector(`#snipe-delete-${snipe.id}`).disabled = true;
     try {
       deleteFunc(snipe.id);
     } finally {
       if (document.querySelector(`#snipe-delete-${snipe.id}`)) {
         document.querySelector(`#snipe-delete-${snipe.id}`).disabled = false;
       }
     }
  });
}

export function configureSniper(policyIdDom, priceDom, traitNameDom, traitValueDom, textNotificationsDom, desktopNotificationsDom, outputDom) {
  try {
    var policyId = validated(document.querySelector(policyIdDom).value, 'Please enter a valid Policy ID');
    var priceStr = validated(document.querySelector(priceDom).value, 'Please enter a price threshold for alerts');
    var price = parseInt(priceStr) * ADA_TO_LOVELACE;
    var snipe = { id: new Date().valueOf(), mostRecentListing: 0, policyId: policyId, price: price };

    snipe.traits = {}
    var traitName = document.querySelector(traitNameDom).value;
    if (traitName) {
      var traitValue = validated(document.querySelector(traitValueDom).value, 'Please enter a trait value for the specified attribute');
      snipe.traits = {[traitName.toLowerCase()]: [traitValue.toLowerCase()]};
    } else {
      validate(!document.querySelector(traitValueDom).value, 'Please enter a name for the specified trait value');
    }

    snipe.notifications = {
        text: document.querySelector(textNotificationsDom).checked,
        desktop: document.querySelector(desktopNotificationsDom).checked
    }

    addCardToDom(snipe, outputDom, deleteSnipe);
    Snipes.push(snipe);
    saveSnipes();

    [priceDom, traitNameDom, traitValueDom].forEach(textDom => document.querySelector(textDom).value = '');
    [textNotificationsDom, desktopNotificationsDom].forEach(checkedDom => document.querySelector(checkedDom).checked = false);
  } catch (err) {
    shortToast(err);
  }
}

export function addExistingSnipesToDom(outputDom, deleteFunc) {
  Snipes.forEach(snipe => addCardToDom(snipe, outputDom, deleteFunc));
}

export async function runSnipeBot() {
  try {
    for (var snipe of Snipes) {
      var jpgStoreSearchParams = new URLSearchParams({
         'policyIds': `["${snipe.policyId}"]`,
         'saleType': 'buy-now',
         'sortBy': 'recently-listed',
         'traits': JSON.stringify(snipe.traits),
         'nameQuery': '',
         'verified': 'default',
         'pagination': '{}',
         'size': 20
      });

      var jpgStoreResponse = await fetch(`${JPG_STORE_SEARCH}?${jpgStoreSearchParams}`);
      validate(jpgStoreResponse.status == 200, jpgStoreResponse.message);

      var responseJson = await jpgStoreResponse.json();
      var newestTime = -1;
      var timeout = 0;
      for (var sale of responseJson.tokens) {
        var listingTime = Date.parse(sale.listed_at);
        if (listingTime <= snipe.mostRecentListing) {
          break;
        }
        var listingLovelace = parseInt(sale.listing_lovelace);
        if (listingLovelace > snipe.price) {
          continue;
        }
        if (snipe.notifications.text) {
          // TODO: Send text message
        }
        if (snipe.notifications.desktop) {
          const priceStr = `${listingLovelace / ADA_TO_LOVELACE}${decodeURIComponent(ADA_SYMBOL_URI)}`
          const snipeMessage = `${sale.display_name} listed for ${priceStr} (${sale.collections.display_name})`;
          const notification = new Notification('CNFT Sniper Bot', {tag: sale.asset_id, body: snipeMessage});
          const jpgStoreUrl = `${JPG_STORE_ASSET}/${sale.asset_id}`
          notification.onclick = (_ => window.open(jpgStoreUrl, NEW_TAB));
          setTimeout(_ => notification.close(), NOTIFICATION_TIMEOUT);
        }
        newestTime = Math.max(listingTime, newestTime);
      }
      snipe.mostRecentListing = Math.max(newestTime, snipe.mostRecentListing);
    }

    setTimeout(runSnipeBot, SNIPER_INTERVAL);
  } catch (err) {
    shortToast(err);
  }
}
