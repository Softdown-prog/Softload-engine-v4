module.exports = {
  getAgent: async (role = 'solaris-chat') => {
    const { Agent } = await import('../../agent/src/agent.js');
    return new Agent({ role });
  }
};
