export const workflowSteps = [
  {
    id: 'hot-reload',
    title: 'Hot Reload',
    detail: 'Run Vite and validate scene updates instantly.',
    status: 'active'
  },
  {
    id: 'scene-state',
    title: 'Declarative State',
    detail: 'Drive visuals from structured configuration objects.',
    status: 'active'
  },
  {
    id: 'visual-regression',
    title: 'Visual Regression',
    detail: 'Capture deterministic screenshots with Playwright.',
    status: 'active'
  },
  {
    id: 'release-gate',
    title: 'Release Gate',
    detail: 'Require build plus screenshot checks before merge.',
    status: 'active'
  },
  {
    id: 'spatial-memory',
    title: 'Spatial Memory',
    detail: 'Persist account-scoped scrapbook pins on globe coordinates.',
    status: 'active'
  }
];

export function renderWorkflowList(mountEl) {
  mountEl.innerHTML = '';

  workflowSteps.forEach((step) => {
    const item = document.createElement('li');
    item.className = 'workflow-item';

    const dot = document.createElement('span');
    dot.className = `workflow-dot ${step.status}`;

    const body = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = step.title;

    const detail = document.createElement('p');
    detail.textContent = step.detail;

    body.appendChild(title);
    body.appendChild(detail);

    item.appendChild(dot);
    item.appendChild(body);
    mountEl.appendChild(item);
  });
}
