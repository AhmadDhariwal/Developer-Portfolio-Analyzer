const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authmiddleware');
const supportController = require('../controllers/support.controller');

// User endpoints
router.post('/tickets', protect, supportController.createTicket);
router.get('/my-tickets', protect, supportController.getMyTickets);
router.get('/tickets/:id', protect, supportController.getTicketById);
router.delete('/tickets/:id', protect, supportController.deleteTicket);

// Admin endpoints
router.get('/admin/tickets', protect, authorizeRoles('admin', 'super_admin'), supportController.getAdminTickets);
router.put('/admin/tickets/:id/status', protect, authorizeRoles('admin', 'super_admin'), supportController.updateTicketStatus);

module.exports = router;
