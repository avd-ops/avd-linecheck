const $ = (id) => document.getElementById(id);
let steps = [];
let current = 0;

function show(index, updateUrl = true) {
  current = Math.max(0, Math.min(index, steps.length - 1));
  const step = steps[current];
  $('step-select').value = step.id;
  $('step-count').textContent = `Step ${current + 1} of ${steps.length}`;
  $('guide-title').textContent = step.title;
  const actions = $('guide-actions');
  actions.replaceChildren(...step.actions.map((action) => {
    const item = document.createElement('li');
    item.textContent = action;
    return item;
  }));
  $('guide-see').textContent = step.whatYouShouldSee;
  $('guide-done').textContent = step.done;
  const source = $('guide-source');
  source.href = step.source.url;
  source.textContent = `Open official instructions: ${step.source.title}`;
  $('step-back').disabled = current === 0;
  $('step-next').disabled = current === steps.length - 1;
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('step', step.id);
    history.replaceState(null, '', url);
  }
}

async function init() {
  const response = await fetch(new URL('steps.json', import.meta.url), { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('Guide list unavailable');
  const manifest = await response.json();
  steps = manifest.steps;
  const select = $('step-select');
  select.replaceChildren(...steps.map((step) => new Option(`${step.platform}: ${step.title}`, step.id)));
  select.disabled = false;
  const requested = new URL(location.href).searchParams.get('step');
  const requestedIndex = steps.findIndex((step) => step.id === requested);
  const initial = Math.max(0, requestedIndex);
  select.addEventListener('change', () => show(steps.findIndex((step) => step.id === select.value)));
  $('step-back').addEventListener('click', () => show(current - 1));
  $('step-next').addEventListener('click', () => show(current + 1));
  show(initial, requestedIndex < 0);
}

init().catch(() => {
  $('guide-title').textContent = 'Guides could not be loaded';
  $('guide-actions').replaceChildren();
});
