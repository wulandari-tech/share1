const mongoose = require('mongoose');

const CommentSchema = new mongoose.Schema({
    text: {
        type: String,
        required: [true, "Comment text cannot be empty"],
        trim: true,
        maxlength: [1000, "Comment cannot exceed 1000 characters"]
    },
    author: {
        id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        username: {
            type: String,
            required: true
        }
    },
    codePost: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Code",
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model("Comment", CommentSchema);