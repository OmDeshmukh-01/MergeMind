import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  GitPullRequest, Search, Filter, ChevronRight, AlertTriangle,
  CheckCircle2, Clock, Loader2, GitMerge, XCircle, RefreshCw
} from 'lucide-react';

const API = 'http://localhost:8000/api';

const STATUS_FILTERS = ['All', 'OPEN', 'MERGED', 'CLOSED'];

export default function AllPRsPage() {
  const navigate = useNavigate();
  const repoUrl = localStorage.getItem('mm_repo_url') || '';

  const [prs, setPrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [refreshing, setRefreshing] = useState(false);

  const fetchPRs = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const params = new URLSearchParams({ repo_url: repoUrl });
      if (statusFilter !== 'All') params.set('status', statusFilter);
      const res = await axios.get(`${API}/prs?${params}`);
      setPrs(res.data.prs || []);
    } catch (err) {
      console.error('Failed to fetch PRs', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (repoUrl) fetchPRs();
  }, [repoUrl, statusFilter]);

  const filtered = prs.filter(pr =>
    pr.title?.toLowerCase().includes(search.toLowerCase()) ||
    pr.author?.toLowerCase().includes(search.toLowerCase()) ||
    String(pr.id).includes(search)
  );

  const statusIcon = (status) => {
    if (status === 'OPEN')   return <Clock className="w-4 h-4 text-green-500" />;
    if (status === 'MERGED') return <GitMerge className="w-4 h-4 text-purple-500" />;
    if (status === 'CLOSED') return <XCircle className="w-4 h-4 text-gray-400" />;
    return <GitPullRequest className="w-4 h-4 text-gray-400" />;
  };

  const statusColor = (status) => {
    if (status === 'OPEN')   return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20';
    if (status === 'MERGED') return 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20';
    if (status === 'CLOSED') return 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700';
    return 'text-gray-500 bg-gray-100';
  };

  const stats = {
    total:  prs.length,
    open:   prs.filter(p => p.status === 'OPEN').length,
    merged: prs.filter(p => p.status === 'MERGED').length,
    errors: prs.filter(p => p.has_errors).length,
  };

  return (
    <div className="p-8 lg:p-12">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">All Pull Requests</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {repoUrl.split('/').slice(-2).join('/')} · {stats.total} total
          </p>
        </div>
        <button
          onClick={() => fetchPRs(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total', value: stats.total,  color: 'text-gray-700 dark:text-gray-300', bg: 'bg-gray-50 dark:bg-gray-800' },
          { label: 'Open',   value: stats.open,   color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/10' },
          { label: 'Merged', value: stats.merged, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/10' },
          { label: 'Issues', value: stats.errors, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/10' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border border-gray-100 dark:border-gray-700 rounded-2xl p-4 text-center`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by title, author, or PR number…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        {/* Status Filter */}
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
          {STATUS_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                statusFilter === f
                  ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* PR List */}
      <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
              <p className="text-sm text-gray-500">Loading pull requests…</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <GitPullRequest className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-gray-500 dark:text-gray-400 font-medium mb-1">No pull requests found</p>
            <p className="text-xs text-gray-400">
              {search ? `No results for "${search}"` : 'No PRs match the current filter.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.map(pr => (
              <button
                key={pr.id}
                onClick={() => navigate(`/dashboard/pr/${pr.id}`)}
                className="w-full flex items-center gap-4 px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left group"
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-sm shrink-0">
                  {pr.author?.charAt(0)?.toUpperCase() || '?'}
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-semibold text-gray-900 dark:text-white text-sm truncate">
                      #{pr.id} {pr.title}
                    </p>
                    {pr.has_errors && (
                      <AlertTriangle className="w-3.5 h-3.5 text-orange-500 shrink-0" title="Issues detected" />
                    )}
                    {!pr.has_errors && pr.agent_status && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" title="Analyzed - clean" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    by {pr.author}
                    {pr.head_branch && (
                      <> · <span className="font-mono">{pr.head_branch}</span></>
                    )}
                    {pr.timestamp && (
                      <> · {new Date(typeof pr.timestamp === 'number' ? pr.timestamp : pr.timestamp).toLocaleDateString()}</>
                    )}
                  </p>
                </div>

                {/* Priority badge */}
                {pr.priority && pr.priority !== 'Normal' && (
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${
                    pr.priority === 'HIGH' || pr.priority === 'High'
                      ? 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400'
                      : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                  }`}>
                    {pr.priority}
                  </span>
                )}

                {/* Status badge */}
                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${statusColor(pr.status)}`}>
                  {statusIcon(pr.status)}
                  {pr.status}
                </span>

                {/* Arrow */}
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-indigo-500 transition-colors shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
