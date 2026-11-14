const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authmiddleware');
const supportController = require('../controllers/support.controller');

// User endpoints
router.post('/tickets', protect, supportController.createTicket);
router.get('/my-tickets', protect, supportController.getMyTickets);
router.get('/tickets/:id', protect, supportController.getTicketById);
router.delete('/tickets/:id', protect, supportController.deleteTicket);
router.post('/tickets/:id/replies', protect, supportController.addReply);

// Admin endpoints
router.get('/admin/tickets', protect, authorizeRoles('admin', 'super_admin'), supportController.getAdminTickets);
router.get('/admin/tickets/:id', protect, authorizeRoles('admin', 'super_admin'), supportController.getAdminTicketById);
router.put('/admin/tickets/:id/status', protect, authorizeRoles('admin', 'super_admin'), supportController.updateTicketStatus);
router.post('/admin/tickets/:id/replies', protect, authorizeRoles('admin', 'super_admin'), supportController.adminAddReply);

module.exports = router;
