const express = require('express');
const router = express.Router();
const Report = require('../models/report');
const Code = require('../models/code'); // Untuk populate
const User = require('../models/user'); // Untuk populate
const { isLoggedIn, isAdmin } = require('../middleware');
const mongoose = require('mongoose');
const ITEMS_PER_PAGE_ADMIN = 10;
router.get('/dashboard', isLoggedIn, isAdmin, async (req, res, next) => {
    try {
        const page = +req.query.page || 1;
        const filterStatus = req.query.status || 'pending'; // Default ke 'pending'

        let query = {};
        if (filterStatus && ['pending', 'reviewed_action_taken', 'reviewed_no_action'].includes(filterStatus)) {
            query.status = filterStatus;
        }

        const totalReports = await Report.countDocuments(query);
        const reports = await Report.find(query)
            .populate('reporter', 'username _id')
            .sort({ createdAt: -1 })
            .skip((page - 1) * ITEMS_PER_PAGE_ADMIN)
            .limit(ITEMS_PER_PAGE_ADMIN)
            .lean();
        
        // Populate reported item details manually (karena refPath tidak selalu mudah)
        for (let report of reports) {
            if (report.reportedItemId && mongoose.Types.ObjectId.isValid(report.reportedItemId)) {
                if (report.reportedItemType === 'Code') {
                    report.reportedItemDetails = await Code.findById(report.reportedItemId).select('title uploader').populate('uploader', 'username').lean();
                } 
                // Tambahkan else if untuk 'Comment' atau 'User' jika diperlukan
            }
        }

        res.render('admin/dashboard', {
            pageTitle: 'Admin Dashboard - Reports',
            reports,
            currentStatusFilter: filterStatus,
            currentPage: page,
            hasNextPage: ITEMS_PER_PAGE_ADMIN * page < totalReports,
            hasPreviousPage: page > 1,
            nextPage: page + 1,
            previousPage: page - 1,
            lastPage: Math.ceil(totalReports / ITEMS_PER_PAGE_ADMIN)
        });
    } catch (err) {
        next(err);
    }
});

// Aksi Admin (Contoh: update status laporan - BELUM SEPENUHNYA FUNGSIONAL DI SINI)
router.post('/reports/:reportId/status', isLoggedIn, isAdmin, async (req, res, next) => {
     const { status, adminNotes } = req.body;
     const backURL = req.header('Referer') || '/admin/dashboard';
     try {
         if (!mongoose.Types.ObjectId.isValid(req.params.reportId)) {
             req.flash('error', 'Invalid report ID.');
             return res.redirect(backURL);
         }
         if (!status || !['pending', 'reviewed_action_taken', 'reviewed_no_action'].includes(status)) {
             req.flash('error', 'Invalid status value.');
             return res.redirect(backURL);
         }

         const report = await Report.findById(req.params.reportId);
         if (!report) {
             req.flash('error', 'Report not found.');
             return res.redirect(backURL);
         }

         report.status = status;
         report.adminNotes = adminNotes || report.adminNotes; // Hanya update jika ada notes baru
         await report.save();

         req.flash('success', 'Report status updated.');
         res.redirect(backURL);
     } catch (err) {
         console.error("Error updating report status:", err);
         req.flash('error', 'Failed to update report status.');
         res.redirect(backURL);
     }
});


module.exports = router;