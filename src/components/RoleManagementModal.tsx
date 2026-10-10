import { assignedRoles } from '../../shared/roles';
import AdminAccounts from './AdminAccounts';
import { authFetch } from '../utils/authFetch';
import React, { useState } from 'react';
import { 
  Users, 
  UserPlus, 
  ShieldCheck, 
  ShieldAlert, 
  UserCheck, 
  Check, 
  Trash2, 
  X, 
  Sparkles, 
  MapPin, 
  Mail, 
  User, 
  Database,
  Lock,
  AlertCircle
} from 'lucide-react';
import { UserRoleRecord, AppRole, UserRegistration } from '../types';

interface RoleManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  roles: UserRoleRecord[];
  registrations?: UserRegistration[];
  activeUser: UserRoleRecord | null;
  onRoleAddedOrUpdated: (updatedRoles: UserRoleRecord[], newActiveUser?: UserRoleRecord) => void;
  districtsList?: string[];
}

export const ROLE_DEFINITIONS: Record<string, {
  title: string;
  badgeBg: string;
  badgeText: string;
  borderColor: string;
  description: string;
  capabilities: string[];
}> = {
  admin: {
    title: 'Administrator',
    badgeBg: 'bg-purple-100',
    badgeText: 'text-purple-800',
    borderColor: 'border-purple-300',
    description: 'Complete administrative authority over the portal, user roles, system blueprints, and compliance settings.',
    capabilities: [
      'Manage & assign team member roles',
      'Upload and clear Multi-District Allocation Blueprints',
      'Authorize quota adjustments and emergency top-ups',
      'Full database access and configuration'
    ]
  },
  warehouse: {
    title: 'Warehouse Team',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-800',
    borderColor: 'border-emerald-300',
    description: 'Complete administrative authority over system blueprints, alongside warehouse stock, packaging, dispatch, and inventory top-ups.',
    capabilities: [
      'Upload, edit, reset, and delete system blueprints',
      'Manage blueprint districts, cycles, facilities, and quotas',
      'Inspect and manage physical cold-chain inventory',
      'Perform stock packaging and dispatch handoffs',
      'Authorize inventory quota adjustments & emergency top-ups',
      'Track antigen batch numbers and warehouse shelf balances'
    ]
  },
  dco: {
    title: 'Warehouse Team (legacy DCO)',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-800',
    borderColor: 'border-emerald-300',
    description: 'Complete administrative authority over system blueprints, alongside warehouse stock, packaging, dispatch, and inventory top-ups.',
    capabilities: [
      'Upload, edit, reset, and delete system blueprints',
      'Manage blueprint districts, cycles, facilities, and quotas',
      'Inspect and manage physical cold-chain inventory',
      'Perform stock packaging and dispatch handoffs',
      'Authorize inventory quota adjustments & emergency top-ups',
      'Track antigen batch numbers and warehouse shelf balances'
    ]
  },
  cca: {
    title: 'CCA Advocate',
    badgeBg: 'bg-blue-100',
    badgeText: 'text-blue-800',
    borderColor: 'border-blue-300',
    description: 'Customer Care Advocate handling live order reception, WhatsApp message cross-checking, and flight dispatches.',
    capabilities: [
      'Perform live WhatsApp ↔ Fulfillment System audits',
      'Cross-check requested vaccines against 67-col Blueprint balance',
      'Authorize flight dispatches and deduct from balance',
      'Log transaction records to compliance ledger'
    ]
  },
  auditor: {
    title: 'Compliance Auditor',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-800',
    borderColor: 'border-slate-300',
    description: 'Compliance team with complete administrative authority over system blueprints, reviewing discrepancies, logs, and ledger integrity.',
    capabilities: [
      'Upload, edit, reset, and delete system blueprints',
      'Manage blueprint districts, cycles, facilities, and quotas',
      'Inspect immutable transaction history ledger',
      'View operational and supply chain dashboards',
      'Analyze discrepancy rates and error prevention stats',
      'Run verification and review compliance records'
    ]
  }
};

export default function RoleManagementModal({
  isOpen,
  onClose,
  roles,
  registrations = [],
  activeUser,
  onRoleAddedOrUpdated,
  districtsList = ['All Districts', 'West Mamprusi', 'Bunkpurugu-Nakpanduri', 'East Mamprusi', 'Chereponi', 'Gushiegu']
}: RoleManagementModalProps) {
  const [activeTab, setActiveTab] = useState<'accounts' | 'manage' | 'add'>('accounts');
  
  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<AppRole[]>(['cca']);
  const [selectedDistrict, setSelectedDistrict] = useState('All Districts');
  
  // UI states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  if (!isOpen) return null;

  const handleCreateOrUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!name.trim()) {
      setErrorMessage('Please enter the team member full name.');
      return;
    }

    if (!email.trim() || !email.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    if (!selectedRoles.length) { setErrorMessage('Select at least one role.'); return; }
    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          roles: selectedRoles,
          district: selectedDistrict,
          addedBy: activeUser?.name || 'Administrator'
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save role');
      }

      setSuccessMessage(`Role successfully assigned to ${name}!`);
      setName('');
      setEmail('');
      setSelectedRoles(['cca']);
      setSelectedDistrict('All Districts');
      
      onRoleAddedOrUpdated(data.roles, data.activeRoleId ? data.roles.find((r: any) => r.id === data.activeRoleId) : undefined);
      
      setTimeout(() => {
        setSuccessMessage(null);
        setActiveTab('manage');
      }, 1200);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error communicating with role management API.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRole = async (id: string, memberName: string) => {
    if (!window.confirm(`Are you sure you want to remove ${memberName} from registered roles?`)) {
      return;
    }

    setDeletingId(id);
    setErrorMessage(null);
    try {
      const res = await authFetch(`/api/roles/${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete role');
      }

      onRoleAddedOrUpdated(data.roles);
      setSuccessMessage(`Role for ${memberName} removed.`);
      setTimeout(() => setSuccessMessage(null), 2500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error deleting role.');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredRoles = roles.filter(r => 
    r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    assignedRoles(r).some(role => role.toLowerCase().includes(searchTerm.toLowerCase()) || ROLE_DEFINITIONS[role]?.title.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (r.district && r.district.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-5xl w-full my-auto overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-[#3B1A5E] to-[#5C2D91] text-white p-5 sm:p-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center shadow-inner">
              <Users className="w-6 h-6 text-purple-200" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-black tracking-tight">Account Administration</h2>
                <span className="text-[10px] bg-purple-400/30 text-purple-100 border border-purple-300/30 px-2 py-0.5 rounded-full font-bold">
                  Admin
                </span>
              </div>
              <p className="text-xs text-purple-200 mt-0.5">
                Manage signed-up accounts, sign-in issues, and team permissions
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cloud Sync Status Bar */}
        <div className="bg-purple-50/80 border-b border-purple-100 px-6 py-2.5 flex items-center justify-between text-xs text-purple-900 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-purple-700" />
            <span className="font-semibold">Administrator workspace</span>
          </div>

          {activeUser && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-slate-500">Current Session:</span>
              <strong className="text-purple-900">{activeUser.name}</strong>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ROLE_DEFINITIONS[activeUser.role]?.badgeBg} ${ROLE_DEFINITIONS[activeUser.role]?.badgeText}`}>
                {assignedRoles(activeUser).map(role => ROLE_DEFINITIONS[role]?.title || role).join(' + ')}
              </span>
            </div>
          )}
        </div>

        {/* Tab Controls */}
        <div className="flex border-b border-slate-200 px-6 pt-3 bg-slate-50/50 shrink-0 overflow-x-auto">
          <button type="button" onClick={() => setActiveTab('accounts')} className={`pb-3 px-4 text-xs font-bold border-b-2 whitespace-nowrap ${activeTab === 'accounts' ? 'border-purple-800 text-purple-800' : 'border-transparent text-slate-500'}`}>Signed-up accounts</button>
          <button
            type="button"
            onClick={() => setActiveTab('manage')}
            className={`pb-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'manage'
                ? 'border-[#5C2D91] text-[#5C2D91]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Active Team Members ({roles.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('add')}
            className={`pb-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'add'
                ? 'border-[#5C2D91] text-[#5C2D91]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            <span>Add / Assign New Role</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Notifications */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2.5 text-xs text-rose-800 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2.5 text-xs text-emerald-800 animate-in fade-in">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {activeTab === 'accounts' ? <AdminAccounts onUpdated={() => onRoleAddedOrUpdated(roles)} onAssignRole={account => { setName(account.name); setEmail(account.email); setSelectedRoles(account.role ? assignedRoles(account) : ['cca']); setSelectedDistrict(account.district || 'All Districts'); setActiveTab('add'); }} /> : activeTab === 'manage' ? (
            <div className="space-y-4">
              {/* Search & Actions */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search by name, email, role..."
                    className="w-full text-xs px-3.5 py-2 pl-9 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                  />
                  <Users className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                </div>

                <button
                  type="button"
                  onClick={() => setActiveTab('add')}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#5C2D91] hover:bg-[#4A2475] text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Assign New Role</span>
                </button>
              </div>

              {registrations.length > 0 && <section className="rounded-2xl border border-purple-200 bg-purple-50 p-4 space-y-3">
                <h3 className="font-bold text-sm text-purple-900">Pending sign-ups ({registrations.length})</h3>
                {registrations.map(registration => <div key={registration.uid} className="flex items-center justify-between gap-3 rounded-xl bg-white p-3">
                  <div className="min-w-0 text-xs text-slate-600"><strong className="block text-sm text-slate-900">{registration.name}</strong><p className="break-all">{registration.email}</p><p>{registration.position} · Nest: {registration.nest}</p></div>
                  <button type="button" onClick={() => { setName(registration.name); setEmail(registration.email); setSelectedRoles(['cca']); setActiveTab('add'); }} className="shrink-0 rounded-lg bg-purple-800 text-white px-3 py-2 text-xs font-bold">Review access</button>
                </div>)}
              </section>}

              {/* Roles List */}
              <div className="grid grid-cols-1 gap-3">
                {filteredRoles.map(member => {
                  const roleDef = ROLE_DEFINITIONS[member.role] || ROLE_DEFINITIONS.cca;
                  const isActive = activeUser?.id === member.id;

                  return (
                    <div 
                      key={member.id}
                      className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                        isActive 
                          ? 'bg-purple-50/50 border-purple-300 ring-2 ring-purple-500/20' 
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs'
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black text-sm uppercase shadow-xs shrink-0 ${
                          member.role === 'admin' ? 'bg-purple-600 text-white' :
                          (member.role === 'warehouse' || member.role === 'dco') ? 'bg-emerald-600 text-white' :
                          member.role === 'cca' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-white'
                        }`}>
                          {member.name.charAt(0) || 'U'}
                        </div>

                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-black text-slate-900">{member.name}</h4>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${roleDef.badgeBg} ${roleDef.badgeText} ${roleDef.borderColor}`}>
                              {assignedRoles(member).map(role => ROLE_DEFINITIONS[role]?.title || role).join(' + ')}
                            </span>
                            {isActive && (
                              <span className="text-[10px] bg-purple-600 text-white font-black px-2 py-0.5 rounded-full shadow-2xs">
                                Active Profile
                              </span>
                            )}
                          </div>

                          {(member.position || member.nest) && <p className="text-xs text-slate-600">{member.position}{member.nest && ` · Nest: ${member.nest}`}</p>}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                              <Mail className="w-3 h-3 text-slate-400" />
                              {member.email}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-slate-400" />
                              {member.district || 'All Districts'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Member Actions */}
                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        <button type="button" onClick={() => { setName(member.name); setEmail(member.email); setSelectedRoles(assignedRoles(member)); setSelectedDistrict(member.district || 'All Districts'); setActiveTab('add'); }} className="px-3 py-2 text-xs font-bold text-purple-800 rounded-lg border border-purple-200">Edit roles</button>
                        {isActive && (
                          <div className="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-100 text-purple-800 text-xs font-bold rounded-xl border border-purple-200">
                            <Check className="w-3.5 h-3.5 text-purple-700" />
                            <span>Current</span>
                          </div>
                        )}

                        {member.id !== activeUser?.id && (
                          <button
                            type="button"
                            disabled={deletingId === member.id}
                            onClick={() => handleDeleteRole(member.id, member.name)}
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                            title="Remove role"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {filteredRoles.length === 0 && (
                  <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-2xl text-slate-500 text-xs">
                    No team members found matching "{searchTerm}".
                  </div>
                )}
              </div>

              {/* Roles Legend Card */}
              <div className="mt-6 bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-purple-700" />
                  Role Definitions & Permissions
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {Object.entries(ROLE_DEFINITIONS).map(([key, def]) => (
                    <div key={key} className="bg-white border border-slate-200 p-3 rounded-xl space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${def.badgeBg} ${def.badgeText}`}>
                          {def.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        {def.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Add New Role Form */
            <form onSubmit={handleCreateOrUpdateRole} className="space-y-5">
              <div className="bg-purple-50/60 border border-purple-200 p-4 rounded-2xl flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-[#5C2D91] shrink-0 mt-0.5" />
                <div className="text-xs text-purple-900 leading-relaxed">
                  <strong className="block font-bold mb-0.5">Assigning New Team Roles</strong>
                  Enter the colleague's full name and email address. When assigned, their role permissions and district scope will immediately save to the Firestore database.
                </div>
              </div>

              {/* Name & Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Full Name <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. Mary Alhassan"
                      className="w-full text-xs px-3.5 py-2.5 pl-9 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                    />
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Email Address <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={e => { setEmail(e.target.value); const member = roles.find(member => member.email.toLowerCase() === e.target.value.trim().toLowerCase()); if (member) { setName(member.name); setSelectedRoles(assignedRoles(member)); setSelectedDistrict(member.district || 'All Districts'); } }}
                      placeholder="e.g. kwame.mensah@zipline.com"
                      className="w-full text-xs px-3.5 py-2.5 pl-9 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                    />
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  </div>
                </div>
              </div>

              {registrations.filter(registration => registration.email === email.trim().toLowerCase()).map(registration => <p key={registration.uid} className="rounded-xl bg-purple-50 p-3 text-sm text-purple-900">Position: {registration.position} · Nest: {registration.nest}. Assign an access role below to approve this account.</p>)}

              {/* District Scope */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  Assigned District Scope
                </label>
                <div className="relative">
                  <select
                    value={selectedDistrict}
                    onChange={e => setSelectedDistrict(e.target.value)}
                    className="w-full text-xs px-3.5 py-2.5 pl-9 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white appearance-none cursor-pointer"
                  >
                    {districtsList.map(dist => (
                      <option key={dist} value={dist}>
                        {dist}
                      </option>
                    ))}
                  </select>
                  <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              {/* Role Selection Cards */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 block">
                  Select Roles (choose one or more) <span className="text-rose-500">*</span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(['admin', 'warehouse', 'cca', 'auditor', ...(selectedRoles.includes('dco') ? ['dco'] : [])] as AppRole[]).map(roleKey => {
                    const def = ROLE_DEFINITIONS[roleKey];
                    const isSelected = selectedRoles.includes(roleKey);

                    return (
                      <div
                        key={roleKey}
                        role="checkbox" aria-checked={isSelected} tabIndex={0}
                        onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setSelectedRoles(current => current.includes(roleKey) ? current.filter(role => role !== roleKey) : [...current, roleKey]); } }}
                        onClick={() => setSelectedRoles(current => current.includes(roleKey) ? current.filter(role => role !== roleKey) : [...current, roleKey])}
                        className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                          isSelected
                            ? 'border-[#5C2D91] bg-purple-50/70 shadow-xs ring-2 ring-purple-500/20'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${def.badgeBg} ${def.badgeText}`}>
                            {def.title}
                          </span>
                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            isSelected ? 'bg-[#5C2D91] border-[#5C2D91] text-white' : 'border-slate-300'
                          }`}>
                            {isSelected && <Check className="w-2.5 h-2.5" />}
                          </div>
                        </div>

                        <p className="text-[11px] text-slate-600 leading-relaxed mb-2">
                          {def.description}
                        </p>

                        <div className="text-[10px] text-slate-500 space-y-0.5 border-t border-slate-100 pt-1.5">
                          {def.capabilities.slice(0, 2).map((cap, i) => (
                            <div key={i} className="flex items-center gap-1">
                              <span className="text-purple-600 font-bold">•</span>
                              <span>{cap}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Form Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setActiveTab('manage')}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#5C2D91] hover:bg-[#4A2475] text-white text-xs font-bold rounded-xl shadow-md transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <span>Saving to Firestore...</span>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      <span>Assign & Save Role</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
          <span>Role updates take effect immediately across all sessions</span>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-600 hover:text-slate-900 font-bold cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
