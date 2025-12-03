const express = require('express');
const {
  listTeams,
  createTeam,
  searchPlayers,
  invitePlayer,
  respondToInvitation,
  getPendingInvites,
  requestToJoinTeam,
  respondJoinRequest,
} = require('../controllers/equipos.controller');
const checkAuth = require('../middleware/auth.middleware');
const router = express.Router();

router.get('/', checkAuth, listTeams);
router.post('/', checkAuth, createTeam);
router.get('/players/search', checkAuth, searchPlayers);
router.post('/invite', checkAuth, invitePlayer);
router.post('/invite/respond', checkAuth, respondToInvitation);
router.get('/invites/pending', checkAuth, getPendingInvites);
router.post('/join-request', checkAuth, requestToJoinTeam);
router.post('/join-request/respond', checkAuth, respondJoinRequest);

module.exports = router;
