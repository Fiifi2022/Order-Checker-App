import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../src/App';
import type { UserRoleRecord } from '../src/types';

const render = (role: string, roles?: string[]) => renderToStaticMarkup(React.createElement(App, { authenticatedUser: {
  id: 'test-user', name: 'Test User', email: 'test@example.com', role, ...(roles ? { roles } : {}), district: 'Test District', createdAt: ''
} as UserRoleRecord }));

test('only administrators see KPI Dashboard and Audit & Activity Log navigation', () => {
  for (const role of ['cca', 'warehouse', 'dco', 'auditor']) {
    const html = render(role);
    assert.doesNotMatch(html, /KPI Dashboard|Audit &amp; Activity Log/);
    assert.match(html, /General Auditor/);
    assert.match(html, /Vaccine Dashboard/);
  }
  for (const html of [render('admin'), render('cca', ['cca', 'admin'])]) {
    assert.match(html, /KPI Dashboard/);
    assert.match(html, /Audit &amp; Activity Log/);
  }
  assert.doesNotMatch(render('admin', ['cca']), /KPI Dashboard|Audit &amp; Activity Log/);
});

test('Extension download tab is available to every signed-in operational role', () => {
  for (const role of ['admin', 'warehouse', 'dco', 'cca', 'auditor']) {
    assert.match(render(role), /aria-label="Download Chrome extension"/);
  }
});
