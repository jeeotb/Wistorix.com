const NON_PREVIEW_SELECTOR = '.td-actions, .action-links, .action-links-5, button, a, input, .td-shared';

// Only a file/row surface may open dashboard preview.
export function shouldOpenDashboardRowPreview(target) {
  return !target?.closest?.(NON_PREVIEW_SELECTOR);
}
