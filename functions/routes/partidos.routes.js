const express = require('express');
const {
  createMatch,
  getMatches,
  joinMatch,
  requestIndividualJoin,
  respondIndividualJoin,
  listIndividualRequests,
  listPitchOptions,
} = require('../controllers/partidos.controller');
const checkAuth = require('../middleware/auth.middleware');
const router = express.Router();

router.get('/pitches', listPitchOptions);
router.post('/', checkAuth, createMatch);
router.get('/', checkAuth, getMatches);
router.post('/join', checkAuth, joinMatch);
router.post('/individual/request', checkAuth, requestIndividualJoin);
router.post('/individual/respond', checkAuth, respondIndividualJoin);
router.get('/individual/pending', checkAuth, listIndividualRequests);

module.exports = router;
