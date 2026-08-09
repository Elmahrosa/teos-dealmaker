const { createRepos } = require('../db/repos');
const dealSimulationSvc = require('./dealSimulation');
const intelligenceSvc = require('./intelligence');

/**
 * Stakeholder Interview/Survey Service
 * Conducts structured interviews with simulated stakeholders and analyzes responses
 */
class InterviewService {
  constructor() {
    this.interviewSessions = new Map();
  }

  /**
   * Start an interview session with stakeholders
   * @param {Object} adapter - Database adapter
   * @param {number} workspaceId - Workspace ID
   * @param {number} dealId - Deal ID
   * @param {string} userId - User identifier
   * @param {Object} options - Interview options
   * @returns {Promise<Object>} Interview session
   */
  async startInterview(adapter, workspaceId, dealId, userId, options = {}) {
    try {
      // Get stakeholder intelligence for the deal
      const stakeholderIntel = await dealSimulationSvc.buildStakeholderIntelligence(
        adapter, workspaceId, dealId
      );

      // Create interview session
      const sessionId = `interview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const sessionData = {
        id: sessionId,
        workspaceId,
        dealId,
        userId,
        stakeholderIntel,
        questions: options.questions || this._generateDefaultQuestions(stakeholderIntel),
        currentQuestionIndex: 0,
        currentStakeholderIndex: 0,
        responses: {},
        startedAt: new Date().toISOString(),
        status: 'active',
        options: {
          interviewType: options.interviewType || 'structured', // structured, exploratory, survey
          ...options
        }
      };

      this.interviewSessions.set(sessionId, sessionData);

      // Get first question for first stakeholder
      const firstQuestion = sessionData.questions[0];
      const firstStakeholder = stakeholderIntel.stakeholders[0] || {
        role: 'Executive Sponsor',
        organization: stakeholderIntel.companyName
      };

      // Generate stakeholder's response to the first question
      const stakeholderResponse = await this._generateStakeholderResponse(
        adapter, workspaceId, firstStakeholder, firstQuestion, stakeholderIntel
      );

      return {
        sessionId,
        stakeholder: firstStakeholder,
        question: firstQuestion,
        response: stakeholderResponse,
        timestamp: new Date().toISOString(),
        progress: {
          question: 1,
          totalQuestions: sessionData.questions.length,
          stakeholder: 1,
          totalStakeholders: stakeholderIntel.stakeholders.length
        }
      };
    } catch (error) {
      console.error('[InterviewService] Error starting interview:', error);
      throw error;
    }
  }

  /**
   * Submit answer to current question and get next
   * @param {Object} adapter - Database adapter
   * @param {number} workspaceId - Workspace ID
   * @param {string} sessionId - Interview session ID
   * @param {string} stakeholderResponse - User's interpretation or note about stakeholder's likely response
   * @returns {Promise<Object>} Next question/response or completion
   */
  async submitResponse(adapter, workspaceId, sessionId, stakeholderResponse) {
    const session = this.interviewSessions.get(sessionId);
    if (!session) {
      throw new Error(`Interview session ${sessionId} not found`);
    }

    if (session.status !== 'active') {
      throw new Error(`Interview session ${sessionId} is not active`);
    }

    try {
      // Record the stakeholder's response (as provided by user or system)
      const questionIndex = session.currentQuestionIndex;
      const stakeholderIndex = session.currentStakeholderIndex;
      const stakeholders = session.stakeholderIntel.stakeholders;
      const questions = session.questions;
      const currentStakeholder = stakeholders[stakeholderIndex];
      const currentQuestion = questions[questionIndex];

      // Store the response
      if (!session.responses[currentStakeholder.role]) {
        session.responses[currentStakeholder.role] = {};
      }
      session.responses[currentStakeholder.role][currentQuestion] = {
        response: stakeholderResponse,
        timestamp: new Date().toISOString()
      };

      // Move to next question or stakeholder
      let isComplete = false;
      let nextQuestion = null;
      let nextStakeholder = null;

      if (questionIndex + 1 < questions.length) {
        // Next question with same stakeholder
        session.currentQuestionIndex = questionIndex + 1;
        nextQuestion = questions[session.currentQuestionIndex];
        nextStakeholder = currentStakeholder;
      } else if (stakeholderIndex + 1 < stakeholders.length) {
        // Move to next stakeholder, reset question index
        session.currentStakeholderIndex = stakeholderIndex + 1;
        session.currentQuestionIndex = 0;
        nextQuestion = questions[0];
        nextStakeholder = stakeholders[session.currentStakeholderIndex];
      } else {
        // Interview complete
        session.status = 'completed';
        session.completedAt = new Date().toISOString();
        isComplete = true;
      }

      // If not complete, generate the stakeholder's response to the next question
      let nextResponse = null;
      if (!isComplete && nextQuestion && nextStakeholder) {
        nextResponse = await this._generateStakeholderResponse(
          adapter, workspaceId, nextStakeholder, nextQuestion, session.stakeholderIntel
        );
      }

      return {
        stakeholder: currentStakeholder,
        question: currentQuestion,
        response: stakeholderResponse, // The one we just submitted
        isComplete,
        nextStakeholder: isComplete ? null : nextStakeholder,
        nextQuestion: isComplete ? null : nextQuestion,
        nextResponse: isComplete ? null : nextResponse,
        progress: {
          question: isComplete ? session.currentQuestionIndex + 1 : session.currentQuestionIndex + 1,
          totalQuestions: questions.length,
          stakeholder: isComplete ? session.currentStakeholderIndex + 1 : session.currentStakeholderIndex + 1,
          totalStakeholders: stakeholders.length
        },
        collectedResponses: session.responses
      };
    } catch (error) {
      console.error('[InterviewService] Error submitting response:', error);
      throw error;
    }
  }

  /**
   * Generate default questions based on stakeholder intelligence
   * @private
   */
  _generateDefaultQuestions(intel) {
    const baseQuestions = [
      "What are your primary objectives for this potential deal?",
      "What concerns or objections do you have about the proposed solution?",
      "What would make you decide NOT to proceed with this deal?",
      "What information do you still need to make a decision?",
      "How do you measure success for this type of initiative?",
      "What is your decision-making process and timeline?",
      "Who else needs to be involved in the decision?",
      "What budget constraints or financial considerations do you have?"
    ];

    // Tailor questions based on stakeholder roles
    const tailoredQuestions = [];
    const roles = intel.stakeholders.map(s => s.role.toLowerCase());

    // Add role-specific questions
    if (roles.some(r => r.includes('ceo') || r.includes('founder') || r.includes('president'))) {
      tailoredQuestions.push("How does this deal align with our long-term strategic vision?");
      tailoredQuestions.push("What risks do you see to our market position or competitive advantage?");
    }

    if (roles.some(r => r.includes('cfo') || r.includes('finance'))) {
      tailoredQuestions.push("What is your expected return on investment timeline?");
      tailoredQuestions.push("What budget flexibility do we have for unexpected costs?");
    }

    if (roles.some(r => r.includes('cto') || r.includes('technology') || r.includes('technical'))) {
      tailoredQuestions.push("How does this solution integrate with our existing technology stack?");
      tailoredQuestions.push("What are the main technical risks or challenges you foresee?");
    }

    if (roles.some(r => r.includes('ciso') || r.includes('security'))) {
      tailoredQuestions.push("What security and compliance requirements must we meet?");
      tailoredQuestions.push("How do you assess the vendor's security practices?");
    }

    if (roles.some(r => r.includes('procurement') || r.includes('purchasing'))) {
      tailoredQuestions.push("What are your standard procurement processes and timelines?");
      tailoredQuestions.push("How do you evaluate total cost of ownership?");
    }

    if (roles.some(r => r.includes('legal'))) {
      tailoredQuestions.push("What legal considerations or contractual terms are most important?");
      tailoredQuestions.push("What liability concerns do you have?");
    }

    // Combine base and tailored, limit to reasonable number
    const allQuestions = [...new Set([...baseQuestions, ...tailoredQuestions])];
    return allQuestions.slice(0, 10); // Limit to 10 questions max
  }

  /**
   * Generate a stakeholder's response to a question
   * @private
   */
  async _generateStakeholderResponse(adapter, workspaceId, stakeholder, question, intel) {
    const context = `You are acting as a ${stakeholder.role} at ${intel.companyName}.
Your influence level is ${stakeholder.influenceLevel}.
Your decision authority is ${stakeholder.decisionAuthority ? 'yes' : 'no'}.
The company is considering a deal with the following context: ${intel.companyName} is evaluating a potential partnership or purchase.`;

    const prompt = `${context}
Based on your role and perspective, please respond to the following question:
${question}

Provide a realistic response that reflects your position, concerns, objectives, and decision-making criteria.`;

    const result = await intelligenceSvc.ask(adapter, workspaceId, prompt);

    return {
      message: result.answer,
      confidence: result.simulated ? 0.7 : 0.9,
      stakeholder: stakeholder.role,
      question
    };
  }

  /**
   * Analyze collected responses and generate insights
   * @param {Object} adapter - Database adapter
   * @param {number} workspaceId - Workspace ID
   * @param {string} sessionId - Interview session ID
   * @returns {Promise<Object>} Analysis of interview responses
   */
  async analyzeResponses(adapter, workspaceId, sessionId) {
    const session = this.interviewSessions.get(sessionId);
    if (!session) {
      throw new Error(`Interview session ${sessionId} not found`);
    }

    if (session.status !== 'completed' && session.status !== 'ended') {
      throw new Error(`Interview session ${sessionId} is not yet complete`);
    }

    try {
      // Synthesize responses across stakeholders
      const analysis = {
        consensusPoints: this._findConsensus(session.responses),
        conflictingViews: this._findConflicts(session.responses),
        unansweredQuestions: this._findGaps(session.responses, session.questions),
        riskFactors: this._extractRisks(session.responses),
        opportunities: this._extractOpportunities(session.responses),
        recommendation: await this._generateRecommendation(adapter, workspaceId, session)
      };

      return {
        sessionId: session.id,
        dealId: session.dealId,
        stakeholderIntel: session.stakeholderIntel,
        analysis,
        completedAt: session.completedAt,
        totalQuestions: session.questions.length,
        totalStakeholders: session.stakeholderIntel.stakeholders.length
      };
    } catch (error) {
      console.error('[InterviewService] Error analyzing responses:', error);
      throw error;
    }
  }

  /**
   * Find points of consensus across stakeholder responses
   * @private
   */
  _findConsensus(responses) {
    // Simplified consensus finding
    const consensus = [];
    // In a real implementation, we would use NLP to find common themes
    // For now, return placeholder
    consensus.push("All stakeholders recognize the need for a solution");
    consensus.push("Budget considerations are important across roles");
    return consensus;
  }

  /**
   * Find conflicting views across stakeholder responses
   * @private
   */
  _findConflicts(responses) {
    // Simplified conflict finding
    const conflicts = [];
    conflicts.push("Technical team concerned about implementation timeline vs. business team wanting quick deployment");
    conflicts.push("Legal emphasizes risk mitigation while sales focuses on opportunity");
    return conflicts;
  }

  /**
   * Find gaps in responses (questions not adequately addressed)
   * @private
   */
  _findGaps(responses, questions) {
    const gaps = [];
    // Check if any question has very few or superficial responses
    questions.forEach((question, index) => {
      let responseCount = 0;
      for (const stakeholder in responses) {
        if (responses[stakeholder][question] &&
            responses[stakeholder][question].response &&
            responses[stakeholder][question].response.length > 20) {
          responseCount++;
        }
      }
      if (responseCount < Object.keys(responses).length * 0.5) {
        gaps.push(question);
      }
    });
    return gaps;
  }

  /**
   * Extract risk factors from responses
   * @private
   */
  _extractRisks(responses) {
    const risks = [];
    const riskKeywords = ['risk', 'concern', 'worry', 'problem', 'issue', 'challenge', 'drawback'];

    for (const stakeholder in responses) {
      for (const question in responses[stakeholder]) {
        const response = responses[stakeholder][question].response.toLowerCase();
        if (riskKeywords.some(kw => response.includes(kw))) {
          risks.push({
            stakeholder,
            question,
            excerpt: responses[stakeholder][question].response.substring(0, 100) + '...'
          });
        }
      }
    }
    return risks.slice(0, 5); // Limit
  }

  /**
   * Extract opportunities from responses
   * @private
   */
  _extractOpportunities(responses) {
    const opportunities = [];
    const oppKeywords = ['opportunity', 'benefit', 'advantage', 'gain', 'improve', 'increase', 'enhance'];

    for (const stakeholder in responses) {
      for (const question in responses[stakeholder]) {
        const response = responses[stakeholder][question].response.toLowerCase();
        if (oppKeywords.some(kw => response.includes(kw))) {
          opportunities.push({
            stakeholder,
            question,
            excerpt: responses[stakeholder][question].response.substring(0, 100) + '...'
          });
        }
      }
    }
    return opportunities.slice(0, 5); // Limit
  }

  /**
   * Generate overall recommendation based on interview
   * @private
   */
  async _generateRecommendation(adapter, workspaceId, session) {
    const question = `Based on the stakeholder interview responses for this deal, what is the recommended approach to proceed? Consider objections, concerns, and alignment points.`;

    const result = await intelligenceSvc.ask(adapter, workspaceId, question);
    return {
      recommendation: result.answer,
      confidence: result.simulated ? 0.7 : 0.9,
      sources: result.evidence
    };
  }

  /**
   * End an interview session early
   * @param {string} sessionId - Interview session ID
   * @returns {Object} Partial results
   */
  endInterview(sessionId) {
    const session = this.interviewSessions.get(sessionId);
    if (!session) {
      throw new Error(`Interview session ${sessionId} not found`);
    }

    session.status = 'ended';
    session.endedAt = new Date().toISOString();

    return {
      sessionId: session.id,
      dealId: session.dealId,
      stakeholderIntel: session.stakeholderIntel,
      collectedResponses: session.responses,
      endedAt: session.endedAt,
      progress: {
        questionsCompleted: session.currentQuestionIndex + 1,
        totalQuestions: session.questions.length,
        stakeholdersCompleted: session.currentStakeholderIndex + 1,
        totalStakeholders: session.stakeholderIntel.stakeholders.length
      }
    };
  }

  /**
   * Get available interview types
   * @returns {Array} Available types
   */
  static getAvailableTypes() {
    return ['structured', 'exploratory', 'survey', '360'];
  }
}

// Export singleton instance
const interviewService = new InterviewService();
module.exports = interviewService;