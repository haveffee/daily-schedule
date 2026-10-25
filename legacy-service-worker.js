/* Legacy-origin migration worker. It does not intercept requests, replace
 * open pages, or alter local data. Existing push subscriptions stay usable. */
'use strict';
const NEW_APP_URL='https://hvf-app.haveffee-assistant.workers.dev/';
function reminderDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:'';}
self.addEventListener('push',event=>{
  let message={};
  try{message=event.data?event.data.json():{};}catch(_){/* Use a visible fallback. */}
  if(!message||typeof message!=='object')message={};
  const title=typeof message.title==='string'?message.title.slice(0,120):'HVF · Напоминание';
  const body=typeof message.body==='string'?message.body.slice(0,300):'Открой новый HVF, чтобы посмотреть свои дела.';
  event.waitUntil(self.registration.showNotification(title,{
    body,icon:new URL('icon-192.png',NEW_APP_URL).href,
    tag:typeof message.tag==='string'?message.tag.slice(0,200):'hvf-reminder',
    data:{date:reminderDate(message.date)},renotify:false
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(NEW_APP_URL),date=reminderDate(event.notification.data?.date);
  target.hash=date?'day/'+date:'day';
  event.waitUntil(self.clients.openWindow(target.href));
});
// Deliberately no skipWaiting, clients.claim, fetch handler, or storage cleanup:
// an existing editor can finish normally before this update becomes active.
