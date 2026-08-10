import { WebSearchCapability } from './web-search.js';
import { Permissions } from '../security/permissions.js';

// Mock da API Gemini
jest.mock('@google/genai');

describe('WebSearchCapability', () => {
  let capability;
  let permissions;
  
  beforeEach(() => {
    permissions = new Permissions({
      permissions: { 'web.search': true }
    });
    capability = new WebSearchCapability({ permissions });
  });

  test('deve executar pesquisa válida', async () => {
    const task = {
      type: 'web.search',
      query: 'Laravel 11 novidades',
      maxResults: 3
    };
    
    // Mock da resposta Gemini
    const result = await capability.search(task);
    
    expect(result.success).toBe(true);
    expect(result.query).toBe('Laravel 11 novidades');
    expect(result.answer).toBeDefined();
    expect(result.sources).toBeDefined();
  });

  test('deve lançar erro para query vazia', async () => {
    await expect(capability.search({ type: 'web.search', query: '' }))
      .rejects.toThrow('query não pode ser vazia');
  });

  test('deve lançar erro para query muito longa', async () => {
    const longQuery = 'a'.repeat(1001);
    await expect(capability.search({ type: 'web.search', query: longQuery }))
      .rejects.toThrow('excede 1000 caracteres');
  });

  test('deve validar domínios bloqueados', async () => {
    const result = await capability.search({
      type: 'web.search',
      query: 'teste',
      allowedDomains: ['laravel.com']
    });
    
    // Filtra fontes não permitidas
    expect(result.sources.every(s => s.url.includes('laravel.com'))).toBe(true);
  });

  test('deve respeitar rate limiting', async () => {
    const task = { type: 'web.search', query: 'teste' };
    
    for (let i = 0; i < 5; i++) {
      await capability.search(task);
    }
    
    await expect(capability.search(task))
      .rejects.toThrow('Limite de 5 pesquisas por task excedido');
  });

  test('deve verificar permissão', async () => {
    const restrictedCapability = new WebSearchCapability({
      permissions: new Permissions({
        permissions: { 'web.search': false }
      })
    });
    
    await expect(restrictedCapability.search({
      type: 'web.search',
      query: 'teste'
    })).rejects.toThrow('Permissão negada');
  });
});
