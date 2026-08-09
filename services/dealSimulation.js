const { createRepos } = require('../db/repos');
const memorySvc = require('./memory');
const providers = require('./providers');
const intelligenceSvc = require('./intelligence');

/**
 * Deal Simulation Service
 * Handles stakeholder intelligence, scenario modeling, and simulation execution
 */
class DealSimulationService {
  constructor() {
    // Source types for stakeholder intelligence
    this.SOURCE_TYPES = {
      ...intelligenceSvc.SOURCE_TYPES,
      stakeholder_model: { label: 'Stakeholder Model' },
      scenario_definition: { label: 'Scenario Definition' },
      simulation_result: { label: 'Simulation Result' }
    };
  }

  /**
   * Build stakeholder intelligence for a deal
   * @param {Object} adapter - Database adapter
   * @param {number} workspaceId - Workspace ID
   * @param {number} dealId - Deal ID
   * @returns {Promise<Object>} Stakeholder intelligence
   */
  async buildStakeholderIntelligence(adapter, workspaceId, dealId) {
    try {
      // Get deal information
      const dealRepo = createRepos(adapter).deals;
      const deal = await dealRepo.get(workspaceId, dealId);
      if (!deal) {
        throw new Error(`Deal ${dealId} not found in workspace ${workspaceId}`);
      }

      // Gather existing intelligence about the deal
      const intelRepo = createRepos(adapter).intelligence;
      const dealDocs = await intelRepo.list(workspaceId);

      // Extract stakeholder information from documents
      const stakeholders = this._extractStakeholdersFromDocs(dealDocs, deal);

      // If insufficient data, use LLM to generate stakeholder model
      if (stakeholders.length === 0) {
        return await this._generateStakeholderModel(adapter, workspaceId, deal);
      }

      return {
        dealId,
        companyName: deal.company_name,
        stakeholders,
        confidence: this._calculateConfidence(stakeholders, dealDocs),
        sources: dealDocs.map(doc => ({
          id: doc.id,
          title: doc.title,
          type: doc.source_type
        }))
      };
    } catch (error) {
      console.error('[DealSimulation] Error building stakeholder intelligence:', error);
      throw error;
    }
  }

  /**
   * Extract stakeholder information from intelligence documents
   * @param {Array} docs - Intelligence documents
   * @param {Object} deal - Deal information
   * @returns {Array} Stakeholder models
   */
  _extractStakeholdersFromDocs(docs, deal) {
    const stakeholders = [];
    const stakeholderKeywords = [
      'ceo', 'cfo', 'cto', 'ciso', 'procurement', 'legal', 'operations',
      'founder', 'president', 'vice president', 'director', 'manager',
      'buyer', 'seller', 'investor', 'partner', 'competitor'
    ];

    for (const doc of docs) {
      const contentLower = (doc.content || '').toLowerCase();
      const titleLower = (doc.title || '').toLowerCase();

      // Look for stakeholder mentions in title or content
      for (const keyword of stakeholderKeywords) {
        if (titleLower.includes(keyword) || contentLower.includes(keyword)) {
          // Extract context around the mention
          const stakeholder = {
            role: this._normalizeRole(keyword),
            organization: deal.company_name,
            mentionedIn: {
              documentId: doc.id,
              documentTitle: doc.title,
              sourceType: doc.source_type
            },
            confidence: 0.7, // Base confidence for mentioned stakeholder
            objectives: [],
            concerns: [],
            influenceLevel: 'medium', // Default
            decisionAuthority: false // Default
          };

          // Avoid duplicates
          const existing = stakeholders.find(s =>
            s.role === stakeholder.role &&
            s.organization === stakeholder.organization
          );
          if (!existing) {
            stakeholders.push(stakeholder);
          }
        }
      }
    }

    return stakeholders;
  }

  /**
   * Normalize stakeholder role from keyword
   * @param {string} keyword - Raw keyword
   * @returns {string} Normalized role
   */
  _normalizeRole(keyword) {
    const roleMap = {
      'ceo': 'Chief Executive Officer',
      'cfo': 'Chief Financial Officer',
      'cto': 'Chief Technology Officer',
      'ciso': 'Chief Information Security Officer',
      'procurement': 'Procurement Lead',
      'legal': 'Legal Counsel',
      'operations': 'Operations Manager',
      'founder': 'Founder',
      'president': 'President',
      'vice president': 'Vice President',
      'director': 'Director',
      'manager': 'Manager',
      'buyer': 'Buyer',
      'seller': 'Seller',
      'investor': 'Investor',
      'partner': 'Partner',
      'competitor': 'Competitor'
    };
    return roleMap[keyword.toLowerCase()] || keyword;
  }

  /**
   * Generate stakeholder model using LLM when insufficient data
   * @param {Object} adapter - Database adapter
   * @param {number} workspaceId - Workspace ID
   * @param {Object} deal - Deal information
   * @returns {Promise<Object>} Generated stakeholder model
   */
  async _generateStakeholderModel(adapter, workspaceId, deal) {
    // Use intelligence service to ask about typical stakeholders for this type of deal
    const question = `What are the typical stakeholders involved in a deal for ${deal.company_name} in the ${deal.stage} stage?`;

    const intelResult = await intelligenceSvc.ask(adapter, workspaceId, question);

    // Parse LLM response to extract stakeholder information
    const stakeholders = this._parseStakeholdersFromText(intelResult.answer || '');

    // If still no stakeholders, create a basic set based on deal stage
    if (stakeholders.length === 0) {
      stakeholders.push(
        { role: 'Executive Sponsor', organization: deal.company_name, influenceLevel: 'high', decisionAuthority: true },
        { role: 'Technical Evaluator', organization: deal.company_name, influenceLevel: 'medium', decisionAuthority: false },
        { role: 'Financial Approver', organization: deal.company_name, influenceLevel: 'high', decisionAuthority: true }
      );
    }

    return {
      dealId: deal.id,
      companyName: deal.company_name,
      stakeholders,
      confidence: 0.6, // Lower confidence for generated model
      sources: [],
      generated: true,
      generationPrompt: question,
      generationResult: intelResult.answer
    };
  }

  /**
   * Parse stakeholder information from text
   * @param {string} text - Text to parse
   * @returns {Array} Stakeholder models
   */
  _parseStakeholdersFromText(text) {
    const stakeholders = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const lineLower = line.toLowerCase();
      // Simple pattern matching for stakeholder roles
      if (lineLower.includes('ceo') || lineLower.includes('chief executive')) {
        stakeholders.push({ role: 'Chief Executive Officer', influenceLevel: 'high', decisionAuthority: true });
      } else if (lineLower.includes('cfo') || lineLower.includes('chief financial')) {
        stakeholders.push({ role: 'Chief Financial Officer', influenceLevel: 'high', decisionAuthority: true });
      } else if (lineLower.includes('cto') || lineLower.includes('chief technology')) {
        stakeholders.push({ role: 'Chief Technology Officer', influenceLevel: 'medium', decisionAuthority: false });
      } else if (lineLower.includes('ciso') || lineLower.includes('chief information security')) {
        stakeholders.push({ role: 'Chief Information Security Officer', influenceLevel: 'medium', decisionAuthority: false });
      } else if (lineLower.includes('procurement')) {
        stakeholders.push({ role: 'Procurement Lead', influenceLevel: 'medium', decisionAuthority: false });
      } else if (lineLower.includes('legal')) {
        stakeholders.push({ role: 'Legal Counsel', influenceLevel: 'low', decisionAuthority: false });
      }
    }

    // Deduplicate by role
    const unique = [];
    const seen = new Set();
    for (const stakeholder of stakeholders) {
      if (!seen.has(stakeholder.role)) {
        seen.add(stakeholder.role);
        unique.push(stakeholder);
      }
    }
    return unique;
  }

  /**
   * Calculate confidence score for stakeholder intelligence
   * @param {Array} stakeholders - Stakeholder models
   * @param {Array} docs - Source documents
   * @returns {number} Confidence score between 0 and 1
   */
  _calculateConfidence(stakeholders, docs) {
    if (stakeholders.length === 0) return 0.1;
    if (docs.length === 0) return 0.3;

    // Base confidence on number of stakeholders and source documents
    let confidence = 0.5;
    confidence += Math.min(stakeholders.length * 0.1, 0.3); // Up to 0.3 for stakeholders
    confidence += Math.min(docs.length * 0.05, 0.2); // Up to 0.2 for documents

    return Math.min(confidence, 0.95); // Cap at 0.95
  }

  /**
   * Create a new simulation scenario for a deal
   * @param {Object} adapter - Database adapter
   * @param {number} workspaceId - Workspace ID
   * @param {number} dealId - Deal ID
   * @param {Object} scenarioData - Scenario data
   * @returns {Promise<Object>} Created scenario
   */
  async createScenario(adapter, workspaceId, dealId, scenarioData) {
    const repo = createRepos(adapter).deal_scenarios;
    return await repo.add({
      workspace_id: workspaceId,
      deal_id: dealId,
      name: scenarioData.name,
      description: scenarioData.description || null,
      scenario_type: scenarioData.type || 'general',
      parameters: scenarioData.parameters || null
    });
  }

  /**
   * Run a simulation scenario
   * @param {Object} adapter - Database adapter
   * @param {number} workspaceId - Workspace ID
   * @param {number} scenarioId - Scenario ID
   * @returns {Promise<Object>} Simulation run result
   */
  async runScenario(adapter, workspaceId, scenarioId) {
    // Record start time
    const startTime = Date.now();

    // Get scenario
    const scenarioRepo = createRepos(adapter).deal_scenarios;
    const scenario = await scenarioRepo.get(workspaceId, scenarioId);
    if (!scenario) {
      throw new Error(`Scenario ${scenarioId} not found`);
    }

    // Update scenario timestamp
    await scenarioRepo.update(workspaceId, scenarioId, {});

    // Create simulation run record
    const runRepo = createRepos(adapter).simulation_runs;
    const run = await runRepo.add({
      workspace_id: workspaceId,
      deal_scenario_id: scenarioId,
      status: 'running',
      started_at: new Date().toISOString()
    });

    try {
      // Execute simulation based on scenario type
      let results;
      switch (scenario.scenario_type) {
        case 'stakeholder_analysis':
          results = await this._runStakeholderAnalysis(adapter, workspaceId, scenario);
          break;
        case 'financial_model':
          results = await this._runFinancialModel(adapter, workspaceId, scenario);
          break;
        case 'risk_assessment':
          results = await this._runRiskAssessment(adapter, workspaceId, scenario);
          break;
        default:
          results = await this._runGeneralSimulation(adapter, workspaceId, scenario);
      }

      // Calculate duration and cost (simplified)
      const durationMs = Date.now() - startTime;
      const costCents = Math.max(1, Math.floor(durationMs / 1000)); // 1 cent per second simplified

      // Complete the run
      await runRepo.complete(workspaceId, run.id, results, durationMs, costCents);

      return {
        id: run.id,
        scenarioId: scenario.id,
        status: 'completed',
        results,
        durationMs,
        costCents
      };
    } catch (error) {
      // Mark run as failed
      await runRepo.update(workspaceId, run.id, {
        status: 'failed',
        completed_at: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Run stakeholder analysis simulation
   * @private
   */
  async _runStakeholderAnalysis(adapter, workspaceId, scenario) {
    // Use intelligence service to analyze stakeholder dynamics
    const question = `Based on the stakeholder model for this deal, what are the likely objections, influence dynamics, and negotiation leverage points?`;

    const intelResult = await intelligenceSvc.ask(adapter, workspaceId, question);

    return {
      type: 'stakeholder_analysis',
      analysis: intelResult.answer,
      stakeholderDynamics: {
        influenceMap: this._generateInfluenceMap(scenario.parameters),
        objectionLikelihood: this._estimateObjectionLikelihood(scenario.parameters),
        negotiationLevers: this._identifyNegotiationLevers(scenario.parameters)
      },
      confidence: intelResult.simulated ? 0.7 : 0.9,
      sources: intelResult.evidence
    };
  }

  /**
   * Run financial model simulation
   * @private
   */
  async _runFinancialModel(adapter, workspaceId, scenario) {
    // Simplified financial modeling
    const params = scenario.parameters || {};
    const baseValue = params.baseValue || 10000;
    const discountRange = params.discountRange || [0, 0.2];

    const minValue = baseValue * (1 - discountRange[1]);
    const maxValue = baseValue * (1 - discountRange[0]);
    const expectedValue = baseValue * (1 - (discountRange[0] + discountRange[1]) / 2);

    return {
      type: 'financial_model',
      valuation: {
        minimum: Math.round(minValue),
        maximum: Math.round(maxValue),
        expected: Math.round(expectedValue),
        currency: params.currency || 'USD'
      },
      assumptions: {
        baseValue: params.baseValue,
        discountRange: params.discountRange,
        marketConditions: params.marketConditions || 'stable'
      },
      confidence: 0.75
    };
  }

  /**
   * Run risk assessment simulation
   * @private
   */
  async _runRiskAssessment(adapter, workspaceId, scenario) {
    // Use intelligence to identify risks
    const question = `What are the key risks associated with this deal scenario?`;

    const intelResult = await intelligenceSvc.ask(adapter, workspaceId, question);

    return {
      type: 'risk_assessment',
      risks: this._extractRisksFromText(intelResult.answer),
      riskMatrix: this._createRiskMatrix(scenario.parameters),
      mitigationStrategies: this._suggestMitigations(intelResult.answer),
      confidence: intelResult.simulated ? 0.7 : 0.85,
      sources: intelResult.evidence
    };
  }

  /**
   * Run general simulation
   * @private
   */
  async _runGeneralSimulation(adapter, workspaceId, scenario) {
    // Fallback simulation
    const question = `Provide insights and recommendations for this deal scenario.`;

    const intelResult = await intelligenceSvc.ask(adapter, workspaceId, question);

    return {
      type: 'general_simulation',
      insights: intelResult.answer,
      recommendations: this._extractRecommendations(intelResult.answer),
      confidence: intelResult.simulated ? 0.6 : 0.8,
      sources: intelResult.evidence
    };
  }

  /**
   * Generate influence map from stakeholder parameters
   * @private
   */
  _generateInfluenceMap(params) {
    // Simplified influence mapping
    const stakeholders = params.stakeholders || [];
    return stakeholders.map(s => ({
      stakeholder: s.role || 'Unknown',
      influenceScore: s.influenceLevel === 'high' ? 0.9 :
                   s.influenceLevel === 'medium' ? 0.6 : 0.3,
      decisionAuthority: s.decisionAuthority || false
    }));
  }

  /**
   * Estimate objection likelihood
   * @private
   */
  _estimateObjectionLikelihood(params) {
    // Simplified objection estimation
    const objections = {
      price: Math.random() * 0.5 + 0.3, // 30-80%
      timeline: Math.random() * 0.4 + 0.2, // 20-60%
      resources: Math.random() * 0.4 + 0.1, // 10-50%
      technical: Math.random() * 0.5 + 0.2 // 20-70%
    };
    return objections;
  }

  /**
   * Identify negotiation levers
   * @private
   */
  _identifyNegotiationLevers(params) {
    // Simplified negotiation levers
    return [
      'Value-based pricing',
      'Implementation timeline flexibility',
      'Support and service levels',
      'Contract term duration',
      'Pilot program options'
    ];
  }

  /**
   * Extract risks from text
   * @private
   */
  _extractRisksFromText(text) {
    const risks = [];
    const riskKeywords = ['risk', 'concern', 'challenge', 'issue', 'problem', 'drawback'];
    const sentences = text.split(/[.!?]+/);

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (riskKeywords.some(kw => lower.includes(kw))) {
        risks.push(sentence.trim());
      }
    }
    return risks.slice(0, 5); // Limit to 5 risks
  }

  /**
   * Create risk matrix from parameters
   * @private
   */
  _createRiskMatrix(params) {
    // Simplified risk matrix
    return {
      probability: {
        low: 0.3,
        medium: 0.5,
        high: 0.2
      },
      impact: {
        low: 0.4,
        medium: 0.4,
        high: 0.2
      }
    };
  }

  /**
   * Suggest mitigation strategies
   * @private
   */
  _suggestMitigations(text) {
    // Extract mitigation-like sentences
    const mitigationKeywords = ['mitigate', 'reduce', 'address', 'solve', 'handle', 'manage'];
    const sentences = text.split(/[.!?]+/);
    const mitigations = [];

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (mitigationKeywords.some(kw => lower.includes(kw))) {
        mitigations.push(sentence.trim());
      }
    }
    return mitigations.slice(0, 3);
  }

  /**
   * Extract recommendations from text
   * @private
   */
  _extractRecommendations(text) {
    const recKeywords = ['recommend', 'suggest', 'propose', 'advise', 'should'];
    const sentences = text.split(/[.!?]+/);
    const recommendations = [];

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (recKeywords.some(kw => lower.includes(kw))) {
        recommendations.push(sentence.trim());
      }
    }
    return recommendations.slice(0, 3);
  }
}

// Export singleton instance
const dealSimulationService = new DealSimulationService();
module.exports = dealSimulationService;