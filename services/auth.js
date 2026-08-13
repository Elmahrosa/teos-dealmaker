'use strict';

const crypto = require('crypto');
const { createRepos } = require('../db/repos');
const identity = require('./identity');
const billing = require('./billing');

/**
 * Hash a password using PBKDF2
 * @param {string} password - The password to hash
 * @param {string} salt - The salt to use
 * @returns {Promise<string>} - The hashed password
 */
function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      resolve(derivedKey.toString('hex'));
    });
  });
}

/**
 * Generate a random salt
 * @returns {string} - Random salt
 */
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Signup a new user and create their workspace
 * @param {Object} adapter - Database adapter
 * @param {Object} userData - User data (email, password, companyName, plan)
 * @returns {Promise<Object>} - Result with user, workspace, and subscription info
 */
async function signup(adapter, userData) {
  const { email, password, companyName, plan = 'solo' } = userData;

  if (!email || !password || !companyName) {
    throw new Error('Email, password, and company name are required');
  }

  // Validate plan
  const validPlans = ['solo', 'growth', 'corporate', 'trial'];
  if (!validPlans.includes(plan)) {
    throw new Error('Invalid plan specified');
  }

  const repos = createRepos(adapter);

  // Check if user already exists
  const existingUser = await repos.users.getByEmail(email);
  if (existingUser) {
    throw new Error('Unable to complete signup with the provided details');
  }

  // Generate salt and hash password
  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);

  // Create user with password hash and salt
  const user = await repos.users.create({
    email,
    display_name: email.split('@')[0], // Use email prefix as display name
    telegram_id: null,
    password_hash: passwordHash,
    salt
  });

  // Create workspace using identity service
  const workspace = await identity.onboardWorkspace(adapter, {
    ownerUserId: user.id,
    companyName,
    plan
  });

  // Get the subscription and initialize mission tracking (do not activate paid subscription here)
// Activation will be handled by webhook after payment confirmation
  const subscription = await repos.subscriptions.get(workspace.id);
  if (subscription) {
    // Ensure missions_used is initialized (should be 0 for new workspace)
    await repos.subscriptions.update(subscription.id, {
      missions_used: 0
      // Status remains 'pending' for paid tiers until webhook confirmation
      // Founder/trial tiers are set to 'active' in the subscription creation above
    });
  }

  return {
    user,
    workspace,
    subscription
  };
}

/**
 * Login a user
 * @param {Object} adapter - Database adapter
 * @param {Object} loginData - Login data (email, password)
 * @returns {Promise<Object>} - Result with user and token info
 */
async function login(adapter, loginData) {
  const { email, password } = loginData;

  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  const repos = createRepos(adapter);

  // Get user by email
  const user = await repos.users.getByEmail(email);
  if (!user) {
    throw new Error('Invalid email or password');
  }

  // Verify password against stored hash
  if (!user.password_hash || !user.salt) {
    throw new Error('Invalid email or password');
  }

  const passwordHash = await hashPassword(password, user.salt);

  // Constant-time comparison to prevent timing attacks
  const candidate = Buffer.from(passwordHash, 'hex');
  const stored = Buffer.from(user.password_hash, 'hex');

  let isValid = false;
  if (candidate.length === stored.length && candidate.length > 0) {
    isValid = crypto.timingSafeEqual(candidate, stored);
  }

  if (!isValid) {
    throw new Error('Invalid email or password');
  }

  // Remove sensitive data from returned user object
  // eslint-disable-next-line no-unused-vars
  const { password_hash, salt, ...safeUser } = user;

  return {
    user: safeUser
  };
}

/**
 * Create a workspace for a user (separated from signup for flexibility)
 * @param {Object} adapter - Database adapter
 * @param {Object} userData - User data (userId, companyName, plan)
 * @returns {Promise<Object>} - Workspace and subscription info
 */
async function createWorkspaceForUser(adapter, userData) {
  const { userId, companyName, plan = 'solo' } = userData;

  if (!userId || !companyName) {
    throw new Error('User ID and company name are required');
  }

  // Validate plan
  const validPlans = ['solo', 'growth', 'corporate', 'trial', 'founder'];
  if (!validPlans.includes(plan)) {
    throw new Error('Invalid plan specified');
  }

  const repos = createRepos(adapter);

  // Check if user exists
  const user = await repos.users.getById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Create workspace using identity service
  const workspace = await identity.onboardWorkspace(adapter, {
    ownerUserId: userId,
    companyName,
    plan
  });

  // Initialize subscription with proper mission tracking (do not activate paid subscription here)
// Activation will be handled by webhook after payment confirmation
  const subscription = await repos.subscriptions.get(workspace.id);
  if (subscription) {
    // Ensure missions_used is initialized (should be 0 for new workspace)
    await repos.subscriptions.update(subscription.id, {
      missions_used: 0
      // Status remains 'pending' for paid tiers until webhook confirmation
      // Founder/trial tiers are set to 'active' in the subscription creation above
    });
  }

  return {
    workspace,
    subscription
  };
}

/**
 * Check if a user is entitled to run missions in their workspace
 * @param {Object} adapter - Database adapter
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} - True if entitled
 */
async function checkUserEntitlement(adapter, userId) {
  // Get user's workspace
  const workspace = await identity.getWorkspaceForUser(adapter, userId);
  if (!workspace) {
    return false;
  }

  // Check entitlement using billing service
  return await billing.isEntitled(adapter, workspace.id);
}

/**
 * Increment mission usage for a user's workspace
 * @param {Object} adapter - Database adapter
 * @param {number} userId - User ID
 * @param {number} increment - Amount to increment (default 1)
 * @returns {Promise<Object>} - Updated subscription
 */
async function incrementUserMissionUsage(adapter, userId, increment = 1) {
  // Get user's workspace
  const workspace = await identity.getWorkspaceForUser(adapter, userId);
  if (!workspace) {
    throw new Error('User workspace not found');
  }

  // Increment mission usage using billing service
  return await billing.incrementMissionsUsed(adapter, workspace.id, increment);
}

module.exports = {
  hashPassword,
  generateSalt,
  signup,
  login,
  createWorkspaceForUser,
  checkUserEntitlement,
  incrementUserMissionUsage
};
