const state = { count: 0 };
function increment(value) { state.count += Number(value); return state.count; }
const load = async (url) => fetch(url);
document.querySelector('#app').innerHTML = '<p>ready</p>';
localStorage.setItem('count', String(state.count));
setTimeout(() => increment(1), 10);
