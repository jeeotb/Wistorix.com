// analytics.js
// Module tracking GA4 cho Wistorix Chrome Extension


const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const MEASUREMENT_ID = 'G-VKCW3LGLF1';  
const API_SECRET = 'N9CeCYSgRlOeY-S7ivLQ6Q'; 


// Tạo hoặc lấy client_id (định danh duy nhất mỗi user)
async function getClientId() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['ga_client_id'], (result) => {
      if (result.ga_client_id) {
        resolve(result.ga_client_id);
      } else {
        const newId = crypto.randomUUID();
        chrome.storage.local.set({ ga_client_id: newId });
        resolve(newId);
      }
    });
  });
}


// Hàm chính: gửi event lên GA4
export async function trackEvent(eventName, params = {}) {
  try {
    const clientId = await getClientId();
    const payload = {
      client_id: clientId,
      events: [{
        name: eventName,
        params: {
          ...params,
          engagement_time_msec: 1,
        }
      }]
    };
    await fetch(
      `${GA4_ENDPOINT}?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
  } catch (error) {
    // Không để lỗi analytics crash app chính
    console.warn('[Analytics] Failed to track event:', error);
  }
}
