const supportService = require('../services/support.service');
const mongoose = require('mongoose');
const validFilter = (value, allowed) => !value || allowed.includes(value);
const validId = (value) => mongoose.isValidObjectId(value);

const createTicket = async (req, res) => {
  try {
    const ticket = await supportService.createTicket(req.user, req.body);
    res.status(201).json({ message: 'Support ticket submitted successfully.', ticket });
  } catch (error) {
    console.warn('Support ticket rejected:', error.message);
    res.status(error.status || 400).json({ message: error.status ? error.message : 'Failed to submit support ticket.' });
  }
};

const getMyTickets = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));

    const result = await supportService.getMyTickets(req.user._id, page, limit);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch tickets.' });
  }
};

const getTicketById = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid ticket ID.' });
    const ticket = await supportService.getTicketById(req.params.id, req.user._id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    res.json(ticket);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch ticket.' });
  }
};

const deleteTicket = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid ticket ID.' });
    const ticket = await supportService.deleteTicket(req.params.id, req.user._id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found or unauthorized.' });
    res.json({ message: 'Ticket deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete ticket.' });
  }
};

const getAdminTickets = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));

    const { status, category, priority, startDate, endDate } = req.query;
    if (!validFilter(status, ['open', 'in_progress', 'resolved', 'closed'])
      || !validFilter(category, ['bug', 'feature_request', 'account_issue', 'billing_issue', 'general_feedback', 'other'])
      || !validFilter(priority, ['low', 'medium', 'high', 'urgent'])
      || (startDate && Number.isNaN(Date.parse(startDate))) || (endDate && Number.isNaN(Date.parse(endDate)))) {
      return res.status(400).json({ message: 'Invalid ticket filters.' });
    }
    const result = await supportService.getAllTickets(page, limit, {
      status, category, priority,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch tickets.' });
  }
};

const updateTicketStatus = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid ticket ID.' });
    const { status } = req.body;
    const ticket = await supportService.updateTicketStatus(req.params.id, status);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    res.json({ message: 'Status updated.', ticket });
  } catch (error) {
    if (error.message === 'Invalid status.') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Failed to update ticket.' });
  }
};

module.exports = {
  createTicket,
  getMyTickets,
  getTicketById,
  deleteTicket,
  getAdminTickets,
  updateTicketStatus
};
