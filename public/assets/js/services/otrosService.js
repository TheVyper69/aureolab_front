import { api } from './api.js';

class CatalogosService {
  // Lens Types
  async listLensTypes() {
    return (await api.get('/lens-types')).data;
  }

  async createLensType(payload) {
    return (await api.post('/lens-types', payload)).data;
  }

  async updateLensType(id, payload) {
    return (await api.put(`/lens-types/${id}`, payload)).data;
  }

  async deleteLensType(id) {
    return (await api.delete(`/lens-types/${id}`)).data;
  }

  // Materials
  async listMaterials() {
    return (await api.get('/materials')).data;
  }

  async createMaterial(payload) {
    return (await api.post('/materials', payload)).data;
  }

  async updateMaterial(id, payload) {
    return (await api.put(`/materials/${id}`, payload)).data;
  }

  async deleteMaterial(id) {
    return (await api.delete(`/materials/${id}`)).data;
  }

  // Suppliers
  async listSuppliers() {
    return (await api.get('/suppliers')).data;
  }

  async createSupplier(payload) {
    return (await api.post('/suppliers', payload)).data;
  }

  async updateSupplier(id, payload) {
    return (await api.put(`/suppliers/${id}`, payload)).data;
  }

  async deleteSupplier(id) {
    return (await api.delete(`/suppliers/${id}`)).data;
  }

  // Boxes
  async listBoxes() {
    return (await api.get('/boxes')).data;
  }

  async createBox(payload) {
    return (await api.post('/boxes', payload)).data;
  }

  async updateBox(id, payload) {
    return (await api.put(`/boxes/${id}`, payload)).data;
  }

  async deleteBox(id) {
    return (await api.delete(`/boxes/${id}`)).data;
  }
}

export const catalogosService = new CatalogosService();