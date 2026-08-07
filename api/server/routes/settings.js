const express = require('express');
const {
  updateFavoritesController,
  getFavoritesController,
} = require('~/server/controllers/FavoritesController');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

/**
 * ai-aflat: `/skills/active` (the per-user skill on/off overrides) was unmounted
 * on 2026-08-07 with the rest of the Skills feature. Nothing in the client had
 * called it since the settings section was deleted, and an authenticated write
 * endpoint for a feature with no UI is a surface, not a spare part. The
 * server-side skill state read that the agent run performs is unaffected — that
 * goes through `loadSkillStates`, not through HTTP.
 */
router.get('/favorites', requireJwtAuth, getFavoritesController);
router.post('/favorites', requireJwtAuth, updateFavoritesController);

module.exports = router;
