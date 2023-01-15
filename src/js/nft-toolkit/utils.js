import {fromHex} from "lucid-cardano";

export function validate(assertion, error) {
  if (!assertion) {
    throw error;
  }
}

export function validated(assertion, error) {
  validate(assertion, error);
  return assertion;
}

export function createCheckboxInput(id, cssClass, label) {
  const inputElement = createFormElement('input', id, '');
  inputElement.type = 'checkbox';

  const spanElement = createFormElement('span', `${id}-span`, '');
  spanElement.textContent = label;

  const labelElement = createFormElement('label', `${id}-label`, cssClass);
  labelElement.appendChild(inputElement);
  labelElement.appendChild(spanElement);
  return labelElement
}

export function createTextInput(id, cssClass, placeholder) {
  var inputElement = createFormElement('input', id, cssClass, placeholder);
  inputElement.type = 'text';
  return inputElement
}

export function createTextareaInput(id, cssClass, placeholder) {
  return createFormElement('textarea', id, cssClass, placeholder);
}

function createFormElement(type, id, cssClass, placeholder) {
  var element = document.createElement(type);
  element.id = id;
  element.className = cssClass;
  if (placeholder) {
    element.placeholder = placeholder;
  }
  return element;
}

export class Utils {
  static assetDisplayName(unit) {
    return new TextDecoder().decode(fromHex(unit.slice(56)));
  }
}
