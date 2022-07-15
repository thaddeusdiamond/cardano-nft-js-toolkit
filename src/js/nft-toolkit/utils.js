export function validate(assertion, error) {
  if (!assertion) {
    throw error;
  }
}

export function validated(assertion, error) {
  validate(assertion, error);
  return assertion;
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
  element.placeholder = placeholder;
  return element;
}
