const NotificationAPISDK = require('notificationapi-node-server-sdk');

let notificationAPIInstance;
const notificationapiObject = NotificationAPISDK.default || NotificationAPISDK;

if (typeof notificationapiObject.init === 'function' && 
    process.env.NOTIFICATIONAPI_CLIENT_ID && 
    process.env.NOTIFICATIONAPI_CLIENT_SECRET) {
    
    try {
        notificationapiObject.init(
            process.env.NOTIFICATIONAPI_CLIENT_ID,
            process.env.NOTIFICATIONAPI_CLIENT_SECRET
        );
        notificationAPIInstance = notificationapiObject;
        console.log("NotificationAPI Server SDK initialized successfully.");
    } catch (initError) {
        console.error("Failed to initialize NotificationAPI Server SDK:", initError);
    }
}

if (!notificationAPIInstance) {
    console.warn("NotificationAPI Server SDK not configured or failed to initialize.");
    notificationAPIInstance = {
        send: async (params) => {
            console.warn("Mock NotificationAPI Send (not configured/initialized):", params);
            return Promise.resolve({ success: true, message: "Mock send successful (NotificationAPI not configured/initialized)" });
        },
        init: () => {
            console.warn("Mock NotificationAPI Init (not configured/initialized)");
        }
    };
}

module.exports = notificationAPIInstance;