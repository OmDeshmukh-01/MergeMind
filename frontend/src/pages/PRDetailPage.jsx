import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  ArrowLeft, GitMerge, GitBranch, AlertTriangle, CheckCircle2,
  Clock, Loader2, Zap, MessageSquare, ExternalLink, ChevronDown,
  ChevronRight, FileCode2, GitCommit, Plus, Minus, RefreshCw,
  ShieldCheck, ShieldAlert, XCircle, Sparkles, Copy, Check,
  Code, ListChecks, Lock, Wrench
} from 'lucide-react';

const API = 'http://localhost:8000/api';

export default function PRDetailPage() {
  const { prNumber } = useParams();
  const navigate = useNavigate();
  const repoUrl = localStorage.getItem('mm_repo_url') || '';

  const [pr, setPr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // UI state
  const [showDiff, setShowDiff] = useState(false);
  const [showCommits, setShowCommits] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  // Action states
  const [analyzing, setAnalyzing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeMsg, setMergeMsg] = useState('');
  const [actionMsg, setActionMsg] = useState({ type: '', text: '' });
  const [copiedCode, setCopiedCode] = useState(false);
  const [showFullRaw, setShowFullRaw] = useState(false);

  // Comment state
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  const fetchPR = useCallback(async () => {
    try {
      const res = await axios.get(
        `${API}/prs/${prNumber}?repo_url=${encodeURIComponent(repoUrl)}`
      );
      setPr(res.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load PR details.');
    } finally {
      setLoading(false);
    }
  }, [prNumber, repoUrl]);

  useEffect(() => {
    fetchPR();
  }, [fetchPR]);

  // Poll while analysis is running
  useEffect(() => {
    if (!pr) return;
    if (pr.agent_status === 'PENDING_APPROVAL' || pr.agent_status === '' || analyzing) {
      const interval = setInterval(fetchPR, 5000);
      return () => clearInterval(interval);
    }
  }, [pr, analyzing, fetchPR]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setActionMsg({ type: 'info', text: '🔍 AI Agent verifying PR priority, checking for errors & generating fixes...' });
    try {
      await axios.post(`${API}/prs/${prNumber}/analyze`, { repo_url: repoUrl, sync: true });
      await fetchPR();
      setActionMsg({ type: 'success', text: '✅ Analysis completed! Priority verified and fixes ready on MergeMind platform.' });
    } catch (err) {
      setActionMsg({ type: 'error', text: err.response?.data?.detail || 'Analysis failed.' });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCopyCode = (codeText) => {
    if (!codeText) return;
    navigator.clipboard.writeText(codeText);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const getIssues = () => {
    if (Array.isArray(pr?.agent_issues) && pr.agent_issues.length > 0) {
      return pr.agent_issues;
    }
    if (pr?.agent_has_errors && pr?.agent_fix) {
      const lines = pr.agent_fix.split('\n');
      const detected = lines.filter(l =>
        /^(?:\*|-|\d+\.)\s+(?:issue|bug|error|problem|missing|incomplete|flaw|warning)/i.test(l.trim()) ||
        l.toLowerCase().includes('problem:') || l.toLowerCase().includes('issue:')
      );
      if (detected.length > 0) {
        return detected.map(l => l.replace(/^(?:\*|-|\d+\.)\s+/, '').trim());
      }
    }
    return [];
  };

  const getFixSteps = () => {
    if (Array.isArray(pr?.agent_fix_steps) && pr.agent_fix_steps.length > 0) {
      return pr.agent_fix_steps;
    }
    if (pr?.agent_fix) {
      const lines = pr.agent_fix.split('\n');
      const steps = [];
      let inCode = false;
      for (const raw of lines) {
        const line = raw.trim();
        if (line.startsWith('```')) {
          inCode = !inCode;
          continue;
        }
        if (inCode) continue;
        if (/^(?:\d+[\.\)]\s+|[-*•]\s+)/.test(line) && line.length > 6) {
          steps.push(line.replace(/^(?:\d+[\.\)]\s+|[-*•]\s+)/, '').trim());
        }
      }
      if (steps.length > 0) return steps;
    }
    return [];
  };

  const getFixCode = () => {
    if (pr?.agent_fix_code && pr.agent_fix_code.trim()) {
      return pr.agent_fix_code.trim();
    }
    if (pr?.agent_fix) {
      const match = pr.agent_fix.match(/```(?:[a-zA-Z0-9_-]*\n)?([\s\S]*?)```/);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return '';
  };

  const handleUseFixInComment = () => {
    const issues = getIssues();
    const steps = getFixSteps();
    const code = getFixCode();

    let text = `### MergeMind PR Review & Suggested Fixes\n\n`;
    if (issues.length > 0) {
      text += `**Issues Detected:**\n` + issues.map(i => `- ${i}`).join('\n') + `\n\n`;
    }
    if (steps.length > 0) {
      text += `**What Fixes To Apply:**\n` + steps.map((s, idx) => `${idx + 1}. ${s}`).join('\n') + `\n\n`;
    }
    if (code) {
      text += `**Suggested Code Fix:**\n\`\`\`\n${code}\n\`\`\`\n\n`;
    } else if (pr?.agent_fix) {
      text += `**Fix Details:**\n${pr.agent_fix}\n`;
    }
    setCommentText(text.trim());
    const el = document.getElementById('comment-box-area');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const handleMerge = async () => {
    setMerging(true);
    setActionMsg({ type: '', text: '' });
    try {
      const res = await axios.post(`${API}/prs/${prNumber}/merge`, {
        repo_url: repoUrl,
        commit_message: mergeMsg || `Merged PR #${prNumber} via MergeMind`,
      });
      setActionMsg({ type: 'success', text: `✅ PR merged successfully! Commit: ${res.data.sha}` });
      fetchPR();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.response?.data?.detail || 'Merge failed.' });
    } finally {
      setMerging(false);
    }
  };

  const handlePostComment = async () => {
    if (!commentText.trim()) return;
    setPostingComment(true);
    try {
      await axios.post(`${API}/prs/${prNumber}/comment`, {
        repo_url: repoUrl,
        comment: commentText,
      });
      setActionMsg({ type: 'success', text: '💬 Comment posted to GitHub successfully!' });
      setCommentText('');
    } catch (err) {
      setActionMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to post comment.' });
    } finally {
      setPostingComment(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
          <p className="text-gray-500 dark:text-gray-400">Loading PR details…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 lg:p-12">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-500 hover:text-gray-900 dark:hover:text-white mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-2xl p-8 text-center">
          <XCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <p className="text-red-700 dark:text-red-400 font-medium">{error}</p>
        </div>
      </div>
    );
  }

  const isMerged = pr?.status === 'MERGED';
  const isClosed = pr?.status === 'CLOSED';
  const canMerge = !isMerged && !isClosed && pr?.mergeable !== false;

  const statusConfig = {
    OPEN:   { color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',   dot: 'bg-green-500',   label: 'Open' },
    MERGED: { color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', dot: 'bg-purple-500', label: 'Merged' },
    CLOSED: { color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',            dot: 'bg-gray-500',   label: 'Closed' },
  };
  const statusStyle = statusConfig[pr?.status] || statusConfig.OPEN;

  const priorityConfig = {
    HIGH:   { color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', label: 'High Priority' },
    LOW:    { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',         label: 'Low Priority' },
    Normal: { color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',            label: 'Normal' },
  };
  const prioStyle = priorityConfig[pr?.agent_priority || 'Normal'] || priorityConfig.Normal;

  const tabs = ['overview', 'changes', 'commits', 'analysis'];

  return (
    <div className="p-6 lg:p-10 max-w-5xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => navigate('/dashboard/all-prs')}
        className="flex items-center gap-2 text-gray-500 hover:text-gray-900 dark:hover:text-white mb-6 transition-colors text-sm font-medium"
      >
        <ArrowLeft className="w-4 h-4" /> All Pull Requests
      </button>

      {/* PR Header */}
      <div className="mb-6">
        <div className="flex flex-wrap items-start gap-3 mb-3">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${statusStyle.color}`}>
            <span className={`w-2 h-2 rounded-full ${statusStyle.dot}`} />
            {statusStyle.label}
          </span>
          {pr?.agent_priority && (
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${prioStyle.color}`}>
              {prioStyle.label}
            </span>
          )}
          {pr?.agent_has_errors && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
              <AlertTriangle className="w-3 h-3" /> Issues Found
            </span>
          )}
          {pr?.agent_status === 'PENDING_APPROVAL' && !pr?.agent_has_errors && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
              <Clock className="w-3 h-3" /> Awaiting Approval
            </span>
          )}
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          #{pr?.pr_number} {pr?.title}
        </h1>
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
          <span>by <strong className="text-gray-700 dark:text-gray-300">{pr?.author}</strong></span>
          <span className="flex items-center gap-1">
            <GitBranch className="w-3.5 h-3.5" />
            <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs">{pr?.head_branch}</code>
            → <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs">{pr?.base_branch}</code>
          </span>
          {pr?.github_url && (
            <a href={pr.github_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
              <ExternalLink className="w-3.5 h-3.5" /> View on GitHub
            </a>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{pr?.changed_files?.length || 0}</p>
          <p className="text-xs text-gray-500 mt-1">Files Changed</p>
        </div>
        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold text-green-600">+{pr?.additions || 0}</p>
          <p className="text-xs text-gray-500 mt-1">Additions</p>
        </div>
        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold text-red-500">−{pr?.deletions || 0}</p>
          <p className="text-xs text-gray-500 mt-1">Deletions</p>
        </div>
      </div>

      {/* Action message */}
      {actionMsg.text && (
        <div className={`mb-6 p-4 rounded-2xl text-sm font-medium border ${
          actionMsg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/10 dark:border-green-800 dark:text-green-400' :
          actionMsg.type === 'error'   ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/10 dark:border-red-800 dark:text-red-400' :
                                         'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/10 dark:border-indigo-800 dark:text-indigo-400'
        }`}>
          {actionMsg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl mb-6">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`flex-1 capitalize py-2 px-3 rounded-lg text-sm font-medium transition-all ${
              activeTab === t
                ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Description */}
          <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-indigo-500" /> Description
            </h3>
            {pr?.body ? (
              <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{pr.body}</p>
            ) : (
              <p className="text-sm text-gray-400 italic">No description provided.</p>
            )}
          </div>

          {/* Changed Files quick list */}
          {pr?.changed_files?.length > 0 && (
            <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-indigo-500" /> Changed Files
              </h3>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {pr.changed_files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 text-sm">
                    <span className="font-mono text-gray-700 dark:text-gray-300 truncate mr-4">{f.filename}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-green-600 font-medium text-xs">+{f.additions}</span>
                      <span className="text-red-500 font-medium text-xs">−{f.deletions}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        f.status === 'added'    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        f.status === 'removed'  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                                   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                      }`}>{f.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Merge Section */}
          <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <GitMerge className="w-4 h-4 text-indigo-500" /> Merge Pull Request
            </h3>

            {isMerged ? (
              <div className="flex items-center gap-3 p-4 bg-purple-50 dark:bg-purple-900/10 rounded-xl border border-purple-200 dark:border-purple-800">
                <CheckCircle2 className="w-5 h-5 text-purple-500" />
                <p className="text-sm font-medium text-purple-700 dark:text-purple-400">This PR has been merged.</p>
              </div>
            ) : isClosed ? (
              <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700">
                <XCircle className="w-5 h-5 text-gray-400" />
                <p className="text-sm text-gray-500">This PR has been closed without merging.</p>
              </div>
            ) : pr?.agent_has_errors ? (
              <div className="mb-4 p-4 bg-orange-50 dark:bg-orange-900/10 rounded-xl border border-orange-200 dark:border-orange-800">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-orange-500" />
                  <span className="text-sm font-semibold text-orange-700 dark:text-orange-400">Agent detected issues</span>
                </div>
                <p className="text-xs text-orange-600 dark:text-orange-300">Review the Analysis tab for suggested fixes before merging.</p>
              </div>
            ) : null}

            {!isMerged && !isClosed && (
              <>
                {pr?.mergeable_state && pr.mergeable_state !== 'clean' && pr.mergeable_state !== 'unknown' && (
                  <div className="mb-4 flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-400">
                    <AlertTriangle className="w-4 h-4" />
                    Merge state: <code className="bg-yellow-100 dark:bg-yellow-900/30 px-1.5 py-0.5 rounded text-xs">{pr.mergeable_state}</code>
                  </div>
                )}
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder={`Merge PR #${prNumber} via MergeMind`}
                    value={mergeMsg}
                    onChange={e => setMergeMsg(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    onClick={handleMerge}
                    disabled={merging || !canMerge}
                    className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all ${
                      canMerge && !merging
                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg hover:shadow-indigo-200 dark:hover:shadow-indigo-900'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {merging ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4" />}
                    {merging ? 'Merging…' : 'Merge Pull Request'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── CHANGES TAB ── */}
      {activeTab === 'changes' && (
        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl overflow-hidden">
          <button
            onClick={() => setShowDiff(!showDiff)}
            className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <span className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-indigo-500" /> Diff View
            </span>
            {showDiff ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          </button>
          {showDiff && (
            <div className="border-t border-gray-100 dark:border-gray-700 p-4 overflow-x-auto">
              {pr?.diff ? (
                <pre className="text-xs font-mono leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre">
                  {pr.diff.split('\n').map((line, i) => (
                    <div
                      key={i}
                      className={`px-2 py-0.5 rounded ${
                        line.startsWith('+') && !line.startsWith('+++') ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' :
                        line.startsWith('-') && !line.startsWith('---') ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400' :
                        line.startsWith('@@') ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : ''
                      }`}
                    >
                      {line}
                    </div>
                  ))}
                </pre>
              ) : (
                <p className="text-sm text-gray-400 text-center py-8">No diff available. GitHub token may be required.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── COMMITS TAB ── */}
      {activeTab === 'commits' && (
        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <GitCommit className="w-4 h-4 text-indigo-500" /> Commits ({pr?.commits?.length || 0})
          </h3>
          {pr?.commits?.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No commits available. GitHub token may be required.</p>
          ) : (
            <div className="space-y-3">
              {pr?.commits?.map((c, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-900/50">
                  <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0 mt-0.5">
                    <GitCommit className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{c.message}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <code className="text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-1.5 py-0.5 rounded">{c.sha}</code>
                      <span className="text-xs text-gray-500">{c.author}</span>
                      {c.date && <span className="text-xs text-gray-400">{new Date(c.date).toLocaleDateString()}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ANALYSIS TAB ── */}
      {activeTab === 'analysis' && (
        <div className="space-y-6">
          {/* Platform privacy assurance notice */}
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-800/50">
            <Lock className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed text-indigo-900 dark:text-indigo-200">
              <span className="font-semibold">MergeMind Platform Exclusive:</span> Analysis results, priority classification, and fixes are kept strictly on your MergeMind dashboard. Automated comments to GitHub have been disabled, so nothing is leaked to public pull requests unless you choose to post manually below.
            </div>
          </div>

          {/* Agent Status & Overview */}
          <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" /> AI Agent Verification & Fixes
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={fetchPR}
                  title="Refresh"
                  className="p-2 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-60 shadow-sm"
                >
                  {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {analyzing ? 'Analyzing PR…' : 'Re-analyze PR'}
                </button>
              </div>
            </div>

            {!pr?.agent_priority && !pr?.agent_has_errors ? (
              <div className="text-center py-12 px-4">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mx-auto mb-4">
                  <Zap className="w-7 h-7 text-indigo-500" />
                </div>
                <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-1">No analysis performed yet</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-5">
                  Run the AI Orchestrator to verify whether this PR is High or Low priority and inspect code changes for any fixes needed.
                </p>
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-all shadow-md"
                >
                  {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Verify PR & Generate Fixes
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Priority Card */}
                <div className={`p-5 rounded-2xl border transition-all ${
                  pr.agent_priority === 'HIGH'
                    ? 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60'
                    : 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60'
                }`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                      <div className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                        pr.agent_priority === 'HIGH'
                          ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                          : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                      }`}>
                        {pr.agent_priority === 'HIGH' ? (
                          <ShieldAlert className="w-5 h-5" />
                        ) : (
                          <ShieldCheck className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs uppercase tracking-wider font-bold px-2 py-0.5 rounded-md ${
                            pr.agent_priority === 'HIGH'
                              ? 'bg-amber-200/80 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200'
                              : 'bg-emerald-200/80 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-200'
                          }`}>
                            {pr.agent_priority} PRIORITY PR
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            · Verified by Agent
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                          {pr.agent_priority_reason || (
                            pr.agent_priority === 'HIGH'
                              ? 'Touches files with multiple dependents in the codebase graph or critical architecture logic.'
                              : 'Isolated change with low blast radius and minimal dependency impact.'
                          )}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 shrink-0">
                      Status: {pr.agent_status || (pr.agent_has_errors ? 'PENDING_APPROVAL' : 'READY_TO_MERGE')}
                    </span>
                  </div>
                </div>

                {/* Error status & Issues Card */}
                <div className={`p-5 rounded-2xl border ${
                  pr.agent_has_errors
                    ? 'bg-rose-50/70 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/60'
                    : 'bg-green-50/70 dark:bg-green-950/20 border-green-200 dark:border-green-800/60'
                }`}>
                  <div className="flex items-start gap-3.5 mb-3">
                    <div className={`p-2 rounded-xl shrink-0 ${
                      pr.agent_has_errors
                        ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300'
                        : 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-300'
                    }`}>
                      {pr.agent_has_errors ? (
                        <AlertTriangle className="w-5 h-5" />
                      ) : (
                        <CheckCircle2 className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <h4 className={`text-sm font-bold ${
                        pr.agent_has_errors ? 'text-rose-900 dark:text-rose-200' : 'text-green-900 dark:text-green-200'
                      }`}>
                        {pr.agent_has_errors ? 'Issues Found In Code' : 'All Checks Passed — Zero Bugs Detected'}
                      </h4>
                      <p className={`text-xs mt-0.5 ${
                        pr.agent_has_errors ? 'text-rose-700 dark:text-rose-300' : 'text-green-700 dark:text-green-400'
                      }`}>
                        {pr.agent_has_errors
                          ? 'The agent found errors or risks in the diff. Review the clear fixes required below before merging.'
                          : 'Diff verified against codebase graph and RAG context. No logical flaws, syntax errors, or regressions found.'}
                      </p>
                    </div>
                  </div>

                  {/* List of identified issues */}
                  {pr.agent_has_errors && getIssues().length > 0 && (
                    <div className="mt-3 pl-10 space-y-2">
                      <p className="text-xs font-semibold text-rose-800 dark:text-rose-300 uppercase tracking-wide">
                        Identified Issues:
                      </p>
                      {getIssues().map((issue, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs text-rose-900 dark:text-rose-200 bg-white/80 dark:bg-gray-900/60 p-2.5 rounded-xl border border-rose-100 dark:border-rose-900/40">
                          <span className="w-4 h-4 rounded-full bg-rose-200 dark:bg-rose-900/60 text-rose-800 dark:text-rose-300 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                            {idx + 1}
                          </span>
                          <span className="leading-relaxed">{issue}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Clear Actionable Fixes Section */}
                {(pr.agent_has_errors || pr.agent_fix) && (
                  <div className="bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400">
                          <Wrench className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="font-bold text-sm text-gray-900 dark:text-white">
                            What Fixes We Have To Do
                          </h4>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Clear step-by-step resolution suggested by the agent
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={handleUseFixInComment}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Insert into Comment Box
                      </button>
                    </div>

                    {/* Step-by-step fix cards */}
                    {getFixSteps().length > 0 && (
                      <div className="space-y-2.5">
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                          Actionable Steps:
                        </p>
                        {getFixSteps().map((step, idx) => (
                          <div
                            key={idx}
                            className="flex items-start gap-3 p-3.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xs"
                          >
                            <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0 shadow-xs mt-0.5">
                              {idx + 1}
                            </span>
                            <div className="text-xs leading-relaxed text-gray-800 dark:text-gray-200">
                              {step}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Suggested Code snippet */}
                    {getFixCode() && (
                      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-xs">
                        <div className="bg-slate-800 text-slate-200 px-4 py-2.5 flex items-center justify-between text-xs border-b border-slate-700">
                          <span className="font-mono flex items-center gap-2">
                            <Code className="w-3.5 h-3.5 text-indigo-400" /> Suggested Code Fix
                          </span>
                          <button
                            onClick={() => handleCopyCode(getFixCode())}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors text-xs font-medium"
                          >
                            {copiedCode ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                            {copiedCode ? 'Copied!' : 'Copy Code'}
                          </button>
                        </div>
                        <div className="bg-slate-900 p-4 overflow-x-auto">
                          <pre className="text-xs font-mono text-emerald-400 leading-relaxed whitespace-pre">
                            {getFixCode()}
                          </pre>
                        </div>
                      </div>
                    )}

                    {/* Full Raw Output (Collapsible) */}
                    {pr.agent_fix && (
                      <div className="pt-2">
                        <button
                          onClick={() => setShowFullRaw(!showFullRaw)}
                          className="text-xs font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 flex items-center gap-1 transition-colors"
                        >
                          {showFullRaw ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          {showFullRaw ? 'Hide Full Agent Output' : 'View Full Agent Output & Explanation'}
                        </button>
                        {showFullRaw && (
                          <div className="mt-2 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
                            <pre className="text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed overflow-x-auto">
                              {pr.agent_fix}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Manual Post Comment Section */}
          <div id="comment-box-area" className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-500" /> Post Review Note to GitHub
              </h3>
              {(pr?.agent_has_errors || pr?.agent_fix) && (
                <button
                  onClick={handleUseFixInComment}
                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Fill with Suggested Fix
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Write a comment to the developer or send the suggested fixes above. This is <strong>only</strong> posted to GitHub when you explicitly click the button below.
            </p>
            <textarea
              rows={4}
              placeholder="e.g. Please update the banner layout and add null-safety checks as suggested in the analysis..."
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none mb-3 font-mono text-xs"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {commentText.length} characters
              </span>
              <button
                onClick={handlePostComment}
                disabled={postingComment || !commentText.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all shadow-sm"
              >
                {postingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {postingComment ? 'Posting to GitHub…' : 'Post Comment to GitHub'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
