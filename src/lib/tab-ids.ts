// Element ids linking PageTabs to the content they control (WAI-ARIA tabs pattern).

/** Id of the element showing the active tab's content; give it role="tabpanel". */
export const tabPanelId = (idPrefix: string) => `${idPrefix}-panel`;
export const tabId      = (idPrefix: string, key: string) => `${idPrefix}-tab-${key}`;
