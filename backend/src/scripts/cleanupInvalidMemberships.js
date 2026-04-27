const mongoose = require('mongoose');
const Membership = require('../models/membership');
require('dotenv').config();

const cleanupInvalidMemberships = async () => {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI);
    
    console.log('Finding invalid membership records...');
    
    // Find memberships with invalid organizationId
    const invalidMemberships = await Membership.find({
      $or: [
        { organizationId: 'local' },
        { organizationId: { $type: 'string', $not: { $regex: /^[0-9a-fA-F]{24}$/ } } }
      ]
    }).lean();
    
    console.log(`Found ${invalidMemberships.length} invalid membership records`);
    
    if (invalidMemberships.length > 0) {
      console.log('Invalid memberships:', invalidMemberships);
      
      // Delete invalid memberships
      const result = await Membership.deleteMany({
        $or: [
          { organizationId: 'local' },
          { organizationId: { $type: 'string', $not: { $regex: /^[0-9a-fA-F]{24}$/ } } }
        ]
      });
      
      console.log(`Deleted ${result.deletedCount} invalid membership records`);
    }
    
    console.log('Cleanup completed successfully');
  } catch (error) {
    console.error('Cleanup failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Database connection closed');
  }
};

// Run the cleanup if this script is executed directly
if (require.main === module) {
  cleanupInvalidMemberships()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { cleanupInvalidMemberships };