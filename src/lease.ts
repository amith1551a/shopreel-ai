export function acquireRenderLease(): Promise<() => void> {
  if (!navigator.locks) return Promise.reject(new Error('This browser does not support cross-tab rendering protection. Use current Chrome or Edge on localhost or HTTPS.'));
  return new Promise((resolve, reject) => {
    void navigator.locks.request('shopreel-cpu-render', { ifAvailable: true }, lock => {
      if (!lock) { reject(new Error('ShopReel is rendering in another tab. Finish or cancel that video first.')); return; }
      return new Promise<void>(release => resolve(release));
    }).catch(reject);
  });
}
