const express = require('express');
const router = express.Router();
const Code = require('../models/code');

const ITEMS_PER_PAGE = 9; // Adjusted for 3-col layout

router.get('/', async (req, res, next) => {
  const page = +req.query.page || 1;
  const searchQuery = req.query.search || '';
  let query = { isPublic: true };

  if (searchQuery) {
    query.$or = [
      { title: { $regex: searchQuery, $options: 'i' } },
      { description: { $regex: searchQuery, $options: 'i' } },
      { snippetLanguage: { $regex: searchQuery, $options: 'i' } } // Updated field name
    ];
  }
  
  try {
    const totalItems = await Code.countDocuments(query);
    const codes = await Code.find(query)
      .populate('uploader', 'username')
      .sort({ createdAt: -1 })
      .skip((page - 1) * ITEMS_PER_PAGE)
      .limit(ITEMS_PER_PAGE)
      .lean(); // Use lean for better performance if not modifying directly

    res.render('index', {
      codes: codes,
      currentPage: page,
      hasNextPage: ITEMS_PER_PAGE * page < totalItems,
      hasPreviousPage: page > 1,
      nextPage: page + 1,
      previousPage: page - 1,
      lastPage: Math.ceil(totalItems / ITEMS_PER_PAGE),
      searchQuery: searchQuery,
      pageTitle: "SHARE SOURCE CODE"
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;