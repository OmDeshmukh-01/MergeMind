import { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, Clock, AlertCircle, CircleDashed, Loader2, CheckCircle, TriangleAlert } from 'lucide-react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const BRAIN_API = 'http://localhost:8000/api/brain';

export default function DashboardHome() {
  const { user } = useAuth();

  // ── Indexing job polling ─────────────────────────────────────────────────
  const [jobStatus, setJobStatus] = useState(null);
  const [repoUrl, setRepoUrl] = useState(() => localStorage.getItem('mm_repo_url') || '');
  const [availableRepos, setAvailableRepos] = useState([]);
  const navigate = useNavigate();

  // 1. Fetch available repositories from Neo4j (for returning users)
  useEffect(() => {
    const fetchRepos = async () => {
      try {
        const res = await axios.get(`${BRAIN_API}/repositories`);
        setAvailableRepos(res.data);
        
        // Auto-select first repo if none is selected, OR if localStorage is corrupted
        const isValidUrl = res.data.some(r => r.url === repoUrl);
        if ((!repoUrl || !isValidUrl) && res.data.length > 0) {
          const firstRepoUrl = res.data[0].url;
          setRepoUrl(firstRepoUrl);
          localStorage.setItem('mm_repo_url', firstRepoUrl);
          localStorage.setItem('mm_project_name', res.data[0].name);
        } else if (!repoUrl && res.data.length === 0) {
          // If totally empty graph, force them to setup
          navigate('/setup');
        }
      } catch (err) {
        console.error("Failed to load repositories", err);
      }
    };
    fetchRepos();
  }, [repoUrl, navigate]);

  useEffect(() => {
    if (!repoUrl) return;
    let interval;
    const poll = async () => {
      try {
        const res = await axios.get(`${BRAIN_API}/status/latest?repo_url=${encodeURIComponent(repoUrl)}`);
        setJobStatus(res.data);
      } catch {
        // ignore errors
      }
    };
    poll();
    // Continue polling to seamlessly pick up new background jobs from webhooks
    interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [repoUrl]);

  const [dashboardData, setDashboardData] = useState({
    active_prs: [],
    stats: { total_prs: 0, active_prs: 0, total_files: 0, total_entities: 0 }
  });

  useEffect(() => {
    if (!repoUrl) return;
    const fetchDashboard = async () => {
      try {
        const res = await axios.get(`${BRAIN_API}/dashboard?repo_url=${encodeURIComponent(repoUrl)}`);
        setDashboardData(res.data);
      } catch {
        // ignore
      }
    };
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 5000); // Poll every 5s for dashboard updates
    return () => clearInterval(interval);
  }, [repoUrl]);

  // ── Stats ─────────────────────────────────────────────────────────
  const stats = [
    { label: 'Total Pull Requests', value: dashboardData.stats.total_prs, trend: 'All time', icon: CircleDashed, color: 'text-gray-500' },
    { label: 'Active PRs', value: dashboardData.stats.active_prs, trend: 'Open', icon: Clock, color: 'text-blue-500' },
    { label: 'Total Files Indexed', value: dashboardData.stats.total_files, trend: 'In graph', icon: CheckCircle2, color: 'text-green-500' },
    { label: 'Classes & Functions', value: dashboardData.stats.total_entities, trend: 'In graph', icon: CheckCircle2, color: 'text-indigo-500' },
  ];

  const activePRs = dashboardData.active_prs;

  const today = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const firstName = user?.username?.split(' ')[0] || 'there';

  return (
    <div className="p-8 lg:p-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-10 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Hello, {firstName} 👋
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Here's the current status of your repositories.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Project Switcher */}
          {availableRepos.length > 0 && (
            <select
              value={repoUrl}
              onChange={(e) => {
                const url = e.target.value;
                const repo = availableRepos.find(r => r.url === url);
                setRepoUrl(url);
                localStorage.setItem('mm_repo_url', url);
                if (repo) localStorage.setItem('mm_project_name', repo.name);
              }}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            >
              {availableRepos.map(r => (
                <option key={r.id} value={r.url}>{r.name}</option>
              ))}
            </select>
          )}

          {/* Add New Project Button */}
          <button
            onClick={() => navigate('/setup')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white border border-transparent rounded-full px-4 py-2 text-sm font-medium shadow-sm transition-colors"
          >
            + Add New Project
          </button>

          <div className="hidden sm:flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full px-4 py-2 shadow-sm">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{today}</span>
            <Calendar className="w-4 h-4 text-gray-400" />
          </div>
        </div>
      </div>

      {/* Indexing job status card */}
      {jobStatus && jobStatus.status !== 'IDLE' && (
        <div className={`mb-8 rounded-2xl border p-6 ${
          jobStatus.status === 'COMPLETED'
            ? 'bg-green-50 border-green-200 dark:bg-green-900/10 dark:border-green-800'
            : jobStatus.status === 'FAILED'
            ? 'bg-red-50 border-red-200 dark:bg-red-900/10 dark:border-red-800'
            : 'bg-indigo-50 border-indigo-200 dark:bg-indigo-900/10 dark:border-indigo-800'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {jobStatus.status === 'COMPLETED' && <CheckCircle className="w-5 h-5 text-green-500" />}
              {jobStatus.status === 'FAILED' && <TriangleAlert className="w-5 h-5 text-red-500" />}
              {jobStatus.status !== 'COMPLETED' && jobStatus.status !== 'FAILED' && (
                <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
              )}
              <div>
                <p className="font-semibold text-gray-900 dark:text-white text-sm">
                  {jobStatus.status === 'COMPLETED' ? 'Indexing complete' :
                   jobStatus.status === 'FAILED' ? 'Indexing failed' :
                   'Indexing in progress…'}
                </p>
                <p className="text-xs text-gray-500 truncate max-w-xs">{repoUrl}</p>
              </div>
            </div>
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{jobStatus.progress ?? 0}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${
                jobStatus.status === 'FAILED' ? 'bg-red-500' : 'bg-indigo-600'
              }`}
              style={{ width: `${jobStatus.progress ?? 0}%` }}
            />
          </div>
          <div className="flex gap-6 mt-4 text-xs text-gray-600 dark:text-gray-400">
            <span>🗂 {jobStatus.files_discovered ?? 0} discovered</span>
            <span>✅ {jobStatus.files_processed ?? 0} processed</span>
            <span>🔵 {jobStatus.nodes_created ?? 0} nodes</span>
            <span>🔗 {jobStatus.relationships_created ?? 0} relationships</span>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6 shadow-sm flex flex-col">
            <div className="flex justify-between items-start mb-4">
              <div className={`p-3 rounded-xl bg-gray-50 dark:bg-gray-900 ${stat.color}`}>
                <stat.icon className="w-6 h-6" />
              </div>
              <span className="text-3xl font-bold text-gray-900 dark:text-white">{stat.value}</span>
            </div>
            <h3 className="text-gray-500 dark:text-gray-400 font-medium mb-1">{stat.label}</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500">{stat.trend}</p>
          </div>
        ))}
      </div>

      {/* Active PRs table */}
      <div>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Active Pull Requests</h2>
          <button
            onClick={() => navigate('/dashboard/all-prs')}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            View all
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="py-4 px-6 text-sm font-semibold text-gray-500 dark:text-gray-400">PR Title</th>
                  <th className="py-4 px-6 text-sm font-semibold text-gray-500 dark:text-gray-400">Priority</th>
                  <th className="py-4 px-6 text-sm font-semibold text-gray-500 dark:text-gray-400">Status</th>
                  <th className="py-4 px-6 text-sm font-semibold text-gray-500 dark:text-gray-400">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {activePRs.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="py-8 px-6 text-center text-gray-500 dark:text-gray-400">
                      No pull requests found for this repository.
                    </td>
                  </tr>
                ) : activePRs.map((pr) => (
                  <tr
                    key={pr.id}
                    onClick={() => navigate(`/dashboard/pr/${pr.id}`)}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                  >
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xs">
                          {pr.author.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white text-sm">#{pr.id} {pr.title}</p>
                          <p className="text-xs text-gray-500">{pr.author}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        pr.priority?.toUpperCase() === 'HIGH'
                          ? 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400'
                          : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                      }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${pr.priority?.toUpperCase() === 'HIGH' ? 'bg-orange-500' : 'bg-green-500'}`} />
                        {pr.priority}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      <span className={`text-sm font-medium ${
                        pr.status === 'OPEN' ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-300'
                      }`}>
                        {pr.status}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-sm text-gray-500">
                      {new Date(pr.timestamp).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
