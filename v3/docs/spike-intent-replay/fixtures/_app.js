// Shared behaviour for every fixture variant. The DOM changes between
// variants; the *behaviour* never does. That is the point of the spike:
// the task a human wants done is stable, the selectors are not.
(function () {
  function moneyFields(form) {
    return {
      vendor: form.querySelector('[data-behavior="vendor"]'),
      amount: form.querySelector('[data-behavior="amount"]'),
      memo: form.querySelector('[data-behavior="memo"]'),
    };
  }
  window.addEventListener('DOMContentLoaded', function () {
    var form = document.querySelector('form');
    var result = document.querySelector('[data-behavior="result"]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = moneyFields(form);
      var amount = (f.amount.value || '').replace(/[^0-9]/g, '');
      if (!f.vendor.value) {
        result.textContent = '거래처를 선택하세요';
        result.dataset.state = 'error';
        return;
      }
      if (!amount) {
        result.textContent = '금액을 입력하세요';
        result.dataset.state = 'error';
        return;
      }
      result.textContent =
        '등록 완료 · ' + f.vendor.value + ' · ' + Number(amount).toLocaleString('ko-KR') + '원';
      result.dataset.state = 'ok';
    });
  });
})();
