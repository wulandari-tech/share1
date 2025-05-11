const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    type: {
        type: String,
        required: true,
        enum: ['like', 'comment', 'follow']
    },
    targetPost: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Code'
    },
    isRead: {
        type: Boolean,
        default: false
    },
    message: {
        type: String
    }
}, { timestamps: true });

NotificationSchema.index({ recipient: 1, createdAt: -1 });
NotificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

NotificationSchema.methods.generateMessage = async function() {
    if (!this.sender) {
        this.message = "System notification.";
        return;
    }
    const senderUser = await mongoose.model('User').findById(this.sender).select('username').lean();
    if (!senderUser) {
        this.message = "An action occurred from an unknown user.";
        return;
    }
    let postTitle = 'a post';
    if (this.targetPost) {
        const targetPostObj = await mongoose.model('Code').findById(this.targetPost).select('title').lean();
        if (targetPostObj) {
            postTitle = `"${targetPostObj.title}"`;
        }
    }
    switch (this.type) {
        case 'like':
            this.message = `${senderUser.username} liked your post: ${postTitle}.`;
            break;
        case 'comment':
            this.message = `${senderUser.username} commented on your post: ${postTitle}.`;
            break;
        case 'follow':
            this.message = `${senderUser.username} started following you.`;
            break;
        default:
            this.message = `New activity from ${senderUser.username}.`;
    }
};

NotificationSchema.pre('save', async function(next) {
    if (this.isNew && !this.message) {
        try {
            await this.generateMessage();
        } catch (error) {
            console.error("Error generating notification message:", error);
            if(!this.message) this.message = "You have a new notification.";
        }
    }
    next();
});

module.exports = mongoose.model('Notification', NotificationSchema);