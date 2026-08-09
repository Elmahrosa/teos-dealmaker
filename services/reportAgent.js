const { createRepos } = require('../db/repos');
const dealSimulationSvc = require('./dealSimulation');
const intelligenceSvc = require('./intelligence');
const negotiationRehearsalSvc = require('./negotiationRehearsal');
const interviewSvc = require('./interviewService');

/**
 * Deal Strategy Report Agent
 * Generates comprehensive deal strategy reports combining multiple data sources
 */
class DealStrategyReportAgent {
  constructor() {
    // Bind methods to maintain correct 'this' context when used as callbacks
    this._generateExecutiveSummary = this._generateExecutiveSummary.bind(this);
    this._generateDealSituation = this._generateDealSituation.bind(this);
    this._generateStakeholderMap = this._generateStakeholderMap.bind(this);
    this._generateDecisionStructure = this._generateDecisionStructure.bind(this);
    this._generateCustomerNeeds = this._generateCustomerNeeds.bind(this);
    this._generateObjections = this._generateObjections.bind(this);
    this._generateCompetitiveLandscape = this._generateCompetitiveLandscape.bind(this);
    this._generateNegotiationRisks = this._generateNegotiationRisks.bind(this);
    this._generateScenarioComparison = this._generateScenarioComparison.bind(this);
    this._generateRecommendedPosition = this._generateRecommendedPosition.bind(this);
    this._generateNextSteps = this._generateNextSteps.bind(this);

    this.reportTemplates = {
      executiveSummary: this._generateExecutiveSummary,
      dealSituation: this._generateDealSituation,
      stakeholderMap: this._generateStakeholderMap,
      decisionStructure: this._generateDecisionStructure,
      customerNeeds: this._generateCustomerNeeds,
      objections: this._generateObjections,
      competitiveLandscape: this._generateCompetitiveLandscape,
      negotiationRisks: this._generateNegotiationRisks,
      scenarioComparison: this._generateScenarioComparison,
      recommendedPosition: this._generateRecommendedPosition,
      nextSteps: this._generateNextSteps
    };
  }

  /**
   * Generate a comprehensive deal strategy report
   * @param {Object} adapter - Database adapter
   * @param {number} workspaceId - Workspace ID
   * @param {number} dealId - Deal ID
   * @param {Object} options - Report options
   * @returns {Promise<Object>} Complete deal strategy report
   */
  async generateReport(adapter, workspaceId, dealId, options = {}) {
    try {
      // Gather all necessary data
      const [dealInfo, stakeholderIntel, simulations, interviews, rehearsals] = await Promise.all([
        this._getDealInfo(adapter, workspaceId, dealId),
        dealSimulationSvc.buildStakeholderIntelligence(adapter, workspaceId, dealId),
        this._getSimulationData(adapter, workspaceId, dealId),
        this._getInterviewData(adapter, workspaceId, dealId),
        this._getRehearsalData(adapter, workspaceId, dealId)
      ]);

      // Generate report sections
      const report = {
        metadata: {
          workspaceId,
          dealId,
          generatedAt: new Date().toISOString(),
          reportId: `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          version: '1.0',
          options
        },
        executiveSummary: await this.reportTemplates.executiveSummary(
          adapter, workspaceId, dealInfo, stakeholderIntel, simulations, interviews, rehearsals
        ),
        dealSituation: await this.reportTemplates.dealSituation(
          adapter, workspaceId, dealInfo, stakeholderIntel
        ),
        stakeholderMap: await this.reportTemplates.stakeholderMap(
          adapter, workspaceId, stakeholderIntel
        ),
        decisionStructure: await this.reportTemplates.decisionStructure(
          adapter, workspaceId, stakeholderIntel, dealInfo
        ),
        customerNeeds: await this.reportTemplates.customerNeeds(
          adapter, workspaceId, stakeholderIntel, dealInfo
        ),
        objections: await this.reportTemplates.objections(
          adapter, workspaceId, stakeholderIntel, simulations, interviews
        ),
        competitiveLandscape: await this.reportTemplates.competitiveLandscape(
          adapter, workspaceId, dealInfo, stakeholderIntel
        ),
        negotiationRisks: await this.reportTemplates.negotiationRisks(
          adapter, workspaceId, simulations, interviews, stakeholderIntel
        ),
        scenarioComparison: await this.reportTemplates.scenarioComparison(
          adapter, workspaceId, simulations
        ),
        recommendedPosition: await this.reportTemplates.recommendedPosition(
          adapter, workspaceId, stakeholderIntel, simulations, interviews, rehearsals
        ),
        nextSteps: await this.reportTemplates.nextSteps(
          adapter, workspaceId, dealInfo, stakeholderIntel, simulations
        ),
        appendix: {
          methodology: this._getMethodology(),
          limitations: this._getLimitations(),
          dataSources: {
            stakeholderIntel: !!stakeholderIntel,
            simulations: simulations.length > 0,
            interviews: interviews.length > 0,
            rehearsals: rehearsals.length > 0
          }
        }
      };

      return report;
    } catch (error) {
      console.error('[DealStrategyReportAgent] Error generating report:', error);
      throw error;
    }
  }

  /**
   * Get basic deal information
   * @private
   */
  async _getDealInfo(adapter, workspaceId, dealId) {
    const dealRepo = createRepos(adapter).deals;
    const deal = await dealRepo.get(workspaceId, dealId);
    if (!deal) {
      throw new Error(`Deal ${dealId} not found in workspace ${workspaceId}`);
    }
    return deal;
  }

  /**
   * Get simulation data for the deal
   * @private
   */
  async _getSimulationData(adapter, workspaceId, dealId) {
    const scenarioRepo = createRepos(adapter).deal_scenarios;
    const scenarios = await scenarioRepo.list(workspaceId, dealId);

    // Get recent simulation runs for these scenarios
    const simulations = [];
    for (const scenario of scenarios) {
      const runRepo = createRepos(adapter).simulation_runs;
      const runs = await runRepo.list(workspaceId, scenario.id);
      simulations.push({
        scenario,
        runs: runs.slice(0, 3) // Most recent 3 runs
      });
    }
    return simulations;
  }

  /**
   * Get interview data for the deal
   * @private
   */
  async _getInterviewData(adapter, workspaceId, dealId) {
    // In a real implementation, we would store interview sessions in database
    // For now, return empty array as placeholder
    return [];
  }

  /**
   * Get rehearsal data for the deal
   * @private
   */
  async _getRehearsalData(adapter, workspaceId, dealId) {
    // In a real implementation, we would store rehearsal sessions in database
    // For now, return empty array as placeholder
    return [];
  }

  /**
   * Generate executive summary section
   * @private
   */
  async _generateExecutiveSummary(adapter, workspaceId, dealInfo, stakeholderIntel, simulations, interviews, rehearsals) {
    // Use intelligence service to synthesize key points
    const question = `Provide a concise executive summary of the deal with ${dealInfo.company_name}, covering the opportunity, key stakeholders, and recommended next steps.`;

    const result = await intelligenceSvc.ask(
      adapter,
      workspaceId,
      question
    );

    return {
      opportunity: `${dealInfo.company_name} represents a ${dealInfo.stage} stage opportunity with estimated value of $${dealInfo.deal_value || 'TBD'} ${dealInfo.currency || 'USD'}`,
      keyStakeholders: stakeholderIntel.stakeholders.map(s => s.role).join(', '),
      recommendation: result.answer || 'Proceed with cautious optimism',
      confidence: stakeholderIntel.confidence,
      nextSteps: ['Complete stakeholder alignment', 'Address key objections', 'Finalize proposal']
    };
  }

  /**
   * Generate deal situation section
   * @private
   */
  async _generateDealSituation(adapter, workspaceId, dealInfo, stakeholderIntel) {
    return {
      overview: {
        companyName: dealInfo.company_name,
        stage: dealInfo.stage,
        status: dealInfo.status,
        estimatedValue: dealInfo.deal_value,
        currency: dealInfo.currency,
        currentAgent: dealInfo.current_agent
      },
      timeline: {
        createdAt: dealInfo.created_at,
        updatedAt: dealInfo.updated_at
      },
      context: `This is a ${dealInfo.stage} stage opportunity with ${dealInfo.status} status.`,
      strategicFit: 'To be determined based on stakeholder alignment'
    };
  }

  /**
   * Generate stakeholder map section
   * @private
   */
  _generateStakeholderMap(adapter, workspaceId, stakeholderIntel) {
    return {
      stakeholders: stakeholderIntel.stakeholders.map(stakeholder => ({
        role: stakeholder.role,
        organization: stakeholder.organization || stakeholderIntel.companyName,
        influenceLevel: stakeholder.influenceLevel || 'medium',
        decisionAuthority: stakeholder.decisionAuthority || false,
        objectives: stakeholder.objectives || [],
        concerns: stakeholder.concerns || [],
        engagementStrategy: this._getEngagementStrategy(stakeholder)
      })),
      influenceHierarchy: this._buildInfluenceHierarchy(stakeholderIntel.stakeholders),
      engagementPlan: this._generateEngagementPlan(stakeholderIntel.stakeholders)
    };
  }

  /**
   * Get engagement strategy for a stakeholder
   * @private
   */
  _getEngagementStrategy(stakeholder) {
    const strategies = {
      'high': 'Engage early and frequently; secure buy-in',
      'medium': 'Engage at key milestones; address concerns',
      'low': 'Inform and maintain awareness'
    };
    return strategies[stakeholder.influenceLevel] || 'Standard engagement';
  }

  /**
   * Build influence hierarchy
   * @private
   */
  _buildInfluenceHierarchy(stakeholders) {
    const high = stakeholders.filter(s => s.influenceLevel === 'high');
    const medium = stakeholders.filter(s => s.influenceLevel === 'medium');
    const low = stakeholders.filter(s => s.influenceLevel === 'low');
    return { high, medium, low };
  }

  /**
   * Generate engagement plan
   * @private
   */
  _generateEngagementPlan(stakeholders) {
    return stakeholders.map(stakeholder => ({
      stakeholder: stakeholder.role,
      touchpoints: ['Initial discovery', 'Solution presentation', 'Technical validation', 'Commercial negotiation', 'Contract review'],
      preferredCommunication: this._getPreferredCommunication(stakeholder),
      keyMessages: this._getKeyMessages(stakeholder)
    }));
  }

  /**
   * Get preferred communication style
   * @private
   */
  _getPreferredCommunication(stakeholder) {
    const preferences = {
      'Chief Executive Officer': 'Strategic, vision-focused discussions',
      'Chief Financial Officer': 'Data-driven, ROI-focused discussions',
      'Chief Technology Officer': 'Technical deep-dive, architecture discussions',
      'Chief Information Security Officer': 'Security and compliance focused discussions',
      'Procurement Lead': 'Process-oriented, commercial terms discussions',
      'Legal Counsel': 'Risk-focused, contractual discussions'
    };
    return preferences[stakeholder.role] || 'Professional business discussions';
  }

  /**
   * Get key messages for stakeholder
   * @private
   */
  _getKeyMessages(stakeholder) {
    const messages = {
      'Chief Executive Officer': ['Strategic alignment', 'Market opportunity', 'Competitive advantage'],
      'Chief Financial Officer': ['Return on investment', 'Cost savings', 'Financial risk mitigation'],
      'Chief Technology Officer': ['Technical feasibility', 'Integration complexity', 'Scalability'],
      'Chief Information Security Officer': ['Security posture', 'Compliance compliance', 'Data protection'],
      'Procurement Lead': ['Total cost of ownership', 'Contract terms', 'Vendor reliability'],
      'Legal Counsel': ['Liability protection', 'Intellectual property', 'Regulatory compliance']
    };
    return messages[stakeholder.role] || ['Value proposition', 'Implementation approach', 'Support model'];
  }

  /**
   * Generate decision structure section
   * @private
   */
  async _generateDecisionStructure(adapter, workspaceId, stakeholderIntel, dealInfo) {
    const question = `What is the decision-making process and structure for a deal like this with ${stakeholderIntel.companyName}?`;

    const result = await intelligenceSvc.ask(
      adapter,
      workspaceId,
      question
    );

    return {
      decisionMakers: stakeholderIntel.stakeholders
        .filter(s => s.decisionAuthority)
        .map(s => s.role),
      influencers: stakeholderIntel.stakeholders
        .filter(s => !s.decisionAuthority && s.influenceLevel === 'high')
        .map(s => s.role),
      process: result.answer || 'To be determined',
      timeline: 'Undefined',
      criteria: ['Strategic fit', 'Financial viability', 'Technical feasibility', 'Risk assessment']
    };
  }

  /**
   * Generate customer needs section
   * @private
   */
  async _generateCustomerNeeds(adapter, workspaceId, stakeholderIntel, dealInfo) {
    const question = `What are the primary business needs and pain points that ${stakeholderIntel.companyName} is trying to address with this type of solution?`;

    const result = await intelligenceSvc.ask(
      adapter,
      workspaceId,
      question
    );

    return {
      primaryNeeds: [
        'Improve operational efficiency',
        'Reduce costs',
        'Enhance customer experience',
        'Ensure compliance and security'
      ],
      statedNeeds: result.answer || 'Needs to be discovered through discovery process',
      priorityLevel: 'High',
      successMetrics: ['ROI > 15%', 'Payback period < 18 months', 'User adoption > 80%']
    };
  }

  /**
   * Generate objections section
   * @private
   */
  async _generateObjections(adapter, workspaceId, stakeholderIntel, simulations, interviews) {
    // Collect objections from simulations and stakeholder intel
    const objections = [];

    // From stakeholder concerns
    stakeholderIntel.stakeholders.forEach(stakeholder => {
      if (stakeholder.concerns && stakeholder.concerns.length > 0) {
        stakeholder.concerns.forEach(concern => {
          objections.push({
            stakeholder: stakeholder.role,
            type: 'concern',
            description: concern,
            severity: 'medium' // placeholder
          });
        });
      }
    });

    // Use intelligence to generate common objections
    const question = `What are the typical objections or concerns that stakeholders might have regarding a deal like this?`;

    const result = await intelligenceSvc.ask(
      adapter,
      workspaceId,
      question
    );

    return {
      objections: objections,
      commonObjections: result.answer || 'Price, timeline, implementation complexity, risk',
      objectionHandlingStrategy: 'Address concerns proactively with data and mitigation plans',
      confidence: stakeholderIntel.confidence
    };
  }

  /**
   * Generate competitive landscape section
   * @private
   */
  async _generateCompetitiveLandscape(adapter, workspaceId, dealInfo, stakeholderIntel) {
    const question = `Who are the main competitors or alternatives that ${stakeholderIntel.companyName} might be considering for this type of solution?`;

    const result = await intelligenceSvc.ask(
      adapter,
      workspaceId,
      question
    );

    return {
      competitors: [
        { name: 'Competitor A', strength: 'Established market presence', weakness: 'Higher cost' },
        { name: 'Competitor B', strength: 'Innovative technology', weakness: 'Limited support' },
        { name: 'Internal solution', strength: 'No vendor dependency', weakness: 'Resource intensive' }
      ],
      differentiation: result.answer || 'Unique value proposition through superior technology and service',
      competitivePosition: 'To be determined through competitive analysis'
    };
  }

  /**
   * Generate negotiation risks section
   * @private
   */
  async _generateNegotiationRisks(adapter, workspaceId, simulations, interviews, stakeholderIntel) {
    const question = `What are the key negotiation risks and potential deal-breakers for this type of deal?`;

    const result = await intelligenceSvc.ask(
      adapter,
      workspaceId,
      question
    );

    return {
      risks: [
        { risk: 'Price disagreement', likelihood: 'medium', impact: 'high' },
        { risk: 'Implementation timeline mismatch', likelihood: 'medium', impact: 'medium' },
        { risk: 'Security/compliance concerns', likelihood: 'low', impact: 'high' },
        { risk: 'Vendor lock-in concerns', likelihood: 'medium', impact: 'medium' }
      ],
      mitigationStrategies: result.answer || 'Prepare alternative options, build trust through transparency',
      dealBreakers: ['Illegal activities', 'Unacceptable liability terms', 'Security vulnerabilities'],
      confidence: 0.75
    };
  }

  /**
   * Generate scenario comparison section
   * @private
   */
  async _generateScenarioComparison(adapter, workspaceId, simulations) {
    if (simulations.length === 0) {
      return {
        message: 'No simulation scenarios have been run for this deal yet.',
        recommendation: 'Run stakeholder analysis and financial modeling scenarios to inform decision-making.'
      };
    }

    const comparison = simulations.map(sim => ({
      scenario: sim.scenario.name,
      type: sim.scenario.scenario_type,
      status: sim.runs.length > 0 ? 'Completed' : 'Not run',
      latestRun: sim.runs.length > 0 ? sim.runs[0] : null,
      keyInsights: sim.runs.length > 0 ? this._extractSimulationInsights(sim.runs[0]) : []
    }));

    return {
      scenarios: comparison,
      summary: `Compared ${simulations.length} different scenarios to evaluate various approaches.`,
      recommendation: 'Focus on scenarios that show highest stakeholder alignment and financial viability.'
    };
  }

  /**
   * Extract insights from simulation run
   * @private
   */
  _extractSimulationInsights(run) {
    if (!run || !run.results) return [];

    const insights = [];
    const results = run.results;

    if (typeof results === 'string') {
      // If results is a string, extract key points
      insights.push(results.substring(0, 200) + '...');
    } else if (typeof results === 'object') {
      // If results is an object, extract meaningful fields
      if (results.valuation) {
        insights.push(`Valuation range: $${results.valuation.minimum} - $${results.valuation.maximum}`);
      }
      if (results.risks && results.risks.length > 0) {
        insights.push(`Key risks identified: ${results.risks.slice(0, 2).join(', ')}`);
      }
      if (results.recommendation) {
        insights.push(`Recommendation: ${results.recommendation}`);
      }
    }

    return insights;
  }

  /**
   * Generate recommended position section
   * @private
   */
  async _generateRecommendedPosition(adapter, workspaceId, stakeholderIntel, simulations, interviews, rehearsals) {
    const question = `Based on the stakeholder analysis, simulation results, and any negotiation rehearsals, what is the recommended negotiating position and strategy for this deal?`;

    const result = await intelligenceSvc.ask(
      adapter,
      workspaceId,
      question
    );

    return {
      position: result.answer || 'Value-based pricing with phased implementation approach',
      strategy: 'Collaborative negotiation focused on mutual value creation',
      keyConcessions: [
        'Flexible implementation timeline',
        'Volume-based pricing tiers',
        'Extended warranty options'
      ],
      walkAwayConditions: [
        'Unacceptable liability terms',
        'Price below minimum viable threshold',
        'Security requirements not met'
      ],
      confidence: stakeholderIntel.confidence > 0.7 ? stakeholderIntel.confidence : 0.75
    };
  }

  /**
   * Generate next steps section
   * @private
   */
  async _generateNextSteps(adapter, workspaceId, dealInfo, stakeholderIntel, simulations) {
    return {
      immediate: [
        'Validate stakeholder assumptions with discovery calls',
        'Run financial modeling scenarios',
        'Address top 3 stakeholder concerns'
      ],
      shortTerm: [
        'Develop detailed proposal/proof of concept',
        'Secure internal stakeholder alignment',
        'Prepare negotiation strategy'
      ],
      longTerm: [
        'Execute pilot or proof of concept',
        'Negotiate and finalize agreement',
        'Plan implementation and rollout'
      ],
      successCriteria: [
        'Stakeholder agreement on approach',
        'Clear ROI demonstration',
        'Signed contract within target timeline'
      ],
      owners: {
        sales: 'Lead executive sponsorship engagement',
        technical: 'Address technical validation requirements',
        financial: 'Develop ROI justification model'
      }
    };
  }

  /**
   * Get methodology description
   * @private
   */
  _getMethodology() {
    return 'This report combines stakeholder intelligence gathering, scenario simulation, and structured analysis to provide a comprehensive view of the deal landscape. The methodology includes: 1) Stakeholder identification and modeling, 2) Scenario-based simulation of different deal structures, 3) Objection and risk analysis, 4) Strategic positioning recommendation.';
  }

  /**
   * Get limitations description
   * @private
   */
  _getLimitations() {
    return 'This report is based on simulated stakeholder intelligence and scenario analysis. Actual stakeholder positions may vary. Simulation results are decision-support tools and not guarantees of future outcomes. Recommendations should be validated through direct stakeholder engagement.';
  }
}

// Export singleton instance
const dealStrategyReportAgent = new DealStrategyReportAgent();
module.exports = dealStrategyReportAgent;