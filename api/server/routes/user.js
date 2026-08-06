const express = require('express');
const {
  updateUserPluginsController,
  getTermsStatusController,
  acceptTermsController,
  deleteUserController,
  getUserController,
} = require('~/server/controllers/UserController');
const { configMiddleware, canDeleteAccount, requireJwtAuth } = require('~/server/middleware');

const settings = require('./settings');

const router = express.Router();

router.use('/settings', settings);
router.get('/', requireJwtAuth, getUserController);
router.get('/terms', requireJwtAuth, getTermsStatusController);
router.post('/terms/accept', requireJwtAuth, acceptTermsController);
router.post('/plugins', requireJwtAuth, updateUserPluginsController);
router.delete('/delete', requireJwtAuth, canDeleteAccount, configMiddleware, deleteUserController);

module.exports = router;
