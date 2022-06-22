export function shortToast(message) {
  Toastify({text: message, duration: 3000}).showToast();
}

export function longToast(message) {
  Toastify({text: message, duration: 6000}).showToast();
}
