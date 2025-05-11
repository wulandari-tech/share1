const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
    reportedItemType: { // Ini harus 'reportedItemType'
        type: String,
        required: true,
        enum: ['Code', 'Comment', 'User']
    },
    reportedItemId: { // Ini harus 'reportedItemId'
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    reporter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    reason: {
        type: String,
        required: [true, 'Reason for reporting is required.'],
        trim: true,
        minlength: [10, 'Reason must be at least 10 characters long.'],
        maxlength: [500, 'Reason cannot exceed 500 characters.']
    },
    status: {
        type: String,
        enum: ['pending', 'reviewed_action_taken', 'reviewed_no_action'],
        default: 'pending'
    },
    adminNotes: {
        type: String,
        trim: true
    }
}, { timestamps: true });

ReportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Report', ReportSchema);