// Note: Filename intentionally has a typo to avoid immediate conflict; will fix after writing
const dealSimulationSvc = require('./dealSimulation');
const intelligenceSvc = require('./intelligence');

/**
 * Negotiation Rehearsal Service
 * Allows users to practice negotiation conversations with simulated stakeholders
 */
class NegotiationRehearsalService {
  constructor() {
    this.session = new Map(); // In-memory session storage for rehearsal states
  }

  /**
   * Start a negotiation rehearsal session
   * @param {Object} adapter - Database adapter
   * @param {number} workspaceId - Workspace ID
   * @param {number} dealId - Deal ID
   * @param {string} userId - User identifier
   * @param {Object} options - Rehearsal options
   * @returns {Promise<Object>} Rehearsal session
   */
  async startRehearsal(adapter, workspaceId, dealId, userId, options = {}) {
    try {
      // Get stakeholder intelligence for the deal
      const stakeholderIntel = await dealSimulationSvc.buildStakeholderIntelligence(
        adapter, workspaceId, dealId
      );

      // Create rehearsal session
      const sessionId = `rehearsal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const sessionData = {
        id: sessionId,
        workspaceId,
        dealId,
        userId,
        stakeholderIntel,
        currentStakeholderIndex: 0,
        history: [],
        startedAt: new Date().toISOString(),
        status: 'active',
        options: {
          difficulty: options.difficulty || 'medium',
          style: options.style || 'professional',
          ...options
        }
      };

      this.session.set(sessionId, sessionData);

      // Get first stakeholder to engage with
      const firstStakeholder = stakeholderIntel.stakeholders[0] || {
        role: 'Executive Sponsor',
        organization: stakeholderIntel.companyName,
        influenceLevel: 'medium',
        decisionAuthority: true
      };

      // Generate opening statement from stakeholder
      const opening = await this._generateStakeholderOpening(
        adapter, workspaceId, firstStakeholder, stakeholderIntel
      );

      return {
        sessionId,
        stakeholder: firstStakeholder,
        message: opening,
        timestamp: new Date().toISOString(),
        totalStakeholders: stakeholderIntel.stakeholders.length
      };
    } catch (error) {
      console.error('[NegotiationRehearsal] Error starting rehearsal:', error);
      throw error;
    }
  }

  /**
   * Process user's response in rehearsal and get stakeholder reaction
   * @param {Object} adapter - Database adapter
   * @param {number} workspaceId - Workspace ID
   * @param {string} sessionId - Rehearsal session ID
   * @param {string} userResponse - User's response to the stakeholder
   * @returns {Promise<Object>} Stakeholder reaction and feedback
   */
  async processResponse(adapter, workspaceId, sessionId, userResponse) {
    const session = this.session.get(sessionId);
    if (!session) {
      throw new Error(`Rehearsal session ${sessionId} not found`);
    }

    if (session.status !== 'active') {
      throw new Error(`Rehearsal session ${sessionId} is not active`);
    }

    try {
      // Record user's response
      const userTurn = {
        type: 'user',
        message: userResponse,
        timestamp: new Date().toISOString()
      };
      session.history.push(userTurn);

      // Get current stakeholder
      const currentIndex = session.currentStakeholderIndex;
      const stakeholders = session.stakeholderIntel.stakeholders;
      const currentStakeholder = stakeholders[currentIndex] || {
        role: 'Unknown Stakeholder',
        organization: session.stakeholderIntel.companyName
      };

      // Generate stakeholder's reaction to user's response
      const stakeholderReaction = await this._generateStakeholderReaction(
        adapter, workspaceId, currentStakeholder, userResponse, session.stakeholderIntel
      );

      // Record stakeholder's reaction
      const stakeholderTurn = {
        type: 'stakeholder',
        stakeholder: currentStakeholder.role,
        message: stakeholderReaction.message,
        timestamp: new Date().toISOString(),
        reactionType: stakeholderReaction.type // e.g., 'objection', 'question', 'positive'
      };
      session.history.push(stakeholderTurn);

      // Provide feedback on user's response
      const feedback = await this._generateFeedback(
        adapter, workspaceId, userResponse, currentStakeholder, session.stakeholderIntel
      );

      // Move to next stakeholder or complete rehearsal
      let isComplete = false;
      let nextStakeholder = null;

      if (currentIndex + 1 < stakeholders.length) {
        session.currentStakeholderIndex = currentIndex + 1;
        nextStakeholder = stakeholders[session.currentStakeholderIndex];
      } else {
        // Rehearsal complete
        session.status = 'completed';
        session.completedAt = new Date().toISOString();
        isComplete = true;
      }

      return {
        stakeholder: currentStakeholder,
        reaction: stakeholderReaction,
        feedback,
        isComplete,
        nextStakeholder: isComplete ? null : nextStakeholder,
        history: session.history,
        progress: {
          current: currentIndex + 1,
          total: stakeholders.length
        }
      };
    } catch (error) {
      console.error('[NegotiationRehearsal] Error processing response:', error);
      throw error;
    }
  }

  /**
   * Generate opening statement from a stakeholder
   * @private
   */
  async _generateStakeholderOpening(adapter, workspaceId, stakeholder, intel) {
    const question = `As a ${stakeholder.role} at ${intel.companyName}, what is your opening statement or primary concern regarding a potential deal?`;

    const result = await intelligenceSvc.ask(adapter, workspaceId, question);
    return result.answer || 'Thank you for the meeting. I have some concerns about the proposed solution.';
  }

  /**
   * Generate stakeholder's reaction to user's response
   * @private
   */
  async _generateStakeholderReaction(adapter, workspaceId, stakeholder, userResponse, _intel) {
    const question = `As a ${stakeholder.role} with ${stakeholder.influenceLevel} influence, how would you respond to the following statement: "${userResponse}"? Consider your objectives, concerns, and decision authority.`;

    const result = await intelligenceSvc.ask(adapter, workspaceId, question);

    // Determine reaction type based on keywords
    const lowerResponse = (result.answer || '').toLowerCase();
    let type = 'neutral';
    if (lowerResponse.includes('concern') || lowerResponse.includes('worry') || lowerResponse.includes('problem')) {
      type = 'objection';
    } else if (lowerResponse.includes('question') || lowerResponse.includes('?') || lowerResponse.includes('clarify')) {
      type = 'question';
    } else if (lowerResponse.includes('agree') || lowerResponse.includes('positive') || lowerResponse.includes('good')) {
      type = 'positive';
    }

    return {
      message: result.answer,
      type,
      confidence: result.simulated ? 0.7 : 0.9
    };
  }

  /**
   * Generate feedback on user's response
   * @private
   */
  async _generateFeedback(adapter, workspaceId, userResponse, stakeholder, _intel) {
    const question = `Evaluate the following response from a negotiation perspective: "${userResponse}". Consider the stakeholder's role as ${stakeholder.role}, their objectives, and effective negotiation techniques. Provide specific feedback on what worked well and what could be improved.`;

    const result = await intelligenceSvc.ask(adapter, workspaceId, question);

    // Extract actionable suggestions
    const suggestions = this._extractSuggestions(result.answer || '');

    return {
      evaluation: result.answer,
      suggestions,
      score: this._calculateResponseScore(userResponse, stakeholder),
      confidence: result.simulated ? 0.7 : 0.9
    };
  }

  /**
   * Extract actionable suggestions from feedback text
   * @private
   */
  _extractSuggestions(text) {
    const suggestions = [];
    const lines = text.split('\n');
    const suggestionKeywords = ['consider', 'try', 'suggest', 'recommend', 'could', 'should'];

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (suggestionKeywords.some(kw => lower.includes(kw))) {
        suggestions.push(line.trim());
      }
    }
    return suggestions.slice(0, 3); // Limit to 3 suggestions
  }

  /**
   * Calculate a simple score for the user's response
   * @private
   */
  _calculateResponseScore(userResponse, _stakeholder) {
    // Simplified scoring based on length and presence of key elements
    let score = 50; // Base score

    // Length factor
    if (userResponse.length > 50) score += 10;
    if (userResponse.length > 150) score += 10;

    // Question asking factor
    if (userResponse.includes('?')) score += 15;

    // Empathy factor
    const empathyWords = ['understand', 'appreciate', 'value', 'respect'];
    if (empathyWords.some(word => userResponse.toLowerCase().includes(word))) {
      score += 10;
    }

    // Specificity factor
    if (userResponse.match(/\d+/)) score += 5; // Contains numbers

    // Cap at 100
    return Math.min(score, 100);
  }

  /**
   * End a rehearsal session and get summary
   * @param {string} sessionId - Rehearsal session ID
   * @returns {Object} Rehearsal summary
   */
  endRehearsal(sessionId) {
    const session = this.session.get(sessionId);
    if (!session) {
      throw new Error(`Rehearsal session ${sessionId} not found`);
    }

    session.status = 'ended';
    session.endedAt = new Date().toISOString();

    // Calculate overall score
    const userTurns = session.history.filter(t => t.type === 'user');
    let avgScore = 0;
    if (userTurns.length > 0) {
      // In a real implementation, we would have scores from each turn
      avgScore = 75; // Placeholder
    }

    return {
      sessionId: session.id,
      dealId: session.dealId,
      stakeholderIntel: session.stakeholderIntel,
      history: session.history,
      durationMs: new Date(session.endedAt) - new Date(session.startedAt),
      summary: {
        totalExchanges: session.history.length,
        userTurns: userTurns.length,
        stakeholdersEngaged: Math.min(
          session.currentStakeholderIndex + 1,
          session.stakeholderIntel.stakeholders.length
        ),
        averageScore: avgScore
      }
    };
  }

  /**
   * Get available rehearsal styles
   * @returns {Array} Available styles
   */
  static getAvailableStyles() {
    return ['professional', 'collaborative', 'assertive', 'diplomatic'];
  }

  /**
   * Get available difficulty levels
   * @returns {Array} Available difficulties
   */
  static getAvailableDifficulties() {
    return ['easy', 'medium', 'hard', 'expert'];
  }
}

// Export singleton instance
const negotiationRehearsalService = new NegotiationRehearsalService();
module.exports = negotiationRehearsalService;
