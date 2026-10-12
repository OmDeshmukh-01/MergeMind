import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { FilePlus, GitMerge, Layers, LogOut, HelpCircle, GitPullRequest } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const navItems = [
    { name: 'Pull Requests', path: '/dashboard', icon: GitMerge, exact: true },
    { name: 'All PRs', path: '/dashboard/all-prs', icon: GitPullRequest },
    { name: 'Add Doc', path: '/dashboard/add-doc', icon: FilePlus },
    { name: 'Architecture', path: '/dashboard/architecture', icon: Layers },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#f3f4f6] dark:bg-gray-950 p-4 sm:p-6 lg:p-8 flex items-center justify-center">
      <div className="w-full max-w-[1400px] h-[90vh] min-h-[700px] bg-white dark:bg-gray-900 rounded-[2.5rem] shadow-xl flex overflow-hidden border border-gray-100 dark:border-gray-800">

        {/* ── Sidebar ── */}
        <div className="w-64 border-r border-gray-100 dark:border-gray-800 p-8 flex flex-col justify-between flex-shrink-0">
          <div>
            {/* Logo */}
            <div className="flex items-center gap-3 mb-12">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                <div className="w-4 h-4 rounded-full border-2 border-white" />
              </div>
              <span className="font-bold text-xl text-gray-900 dark:text-white">MergeMind</span>
            </div>

            {/* Nav */}
            <nav className="space-y-2">
              {navItems.map((item) => (
                <NavLink
                  key={item.name}
                  to={item.path}
                  end={item.exact}
                  className={({ isActive }) =>
                    `flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-medium ${
                      isActive
                        ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                        : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    }`
                  }
                >
                  <item.icon className="w-5 h-5" />
                  {item.name}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Bottom section */}
          <div className="space-y-2">
            {/* Upgrade card */}
            <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl mb-4">
              <h4 className="font-semibold text-indigo-900 dark:text-indigo-100 text-sm mb-1">Upgrade to Pro</h4>
              <p className="text-xs text-indigo-700 dark:text-indigo-300 mb-3">Get advanced insights</p>
              <button className="w-full bg-indigo-200 dark:bg-indigo-600 text-indigo-900 dark:text-white text-xs font-semibold py-2 rounded-lg hover:bg-indigo-300 dark:hover:bg-indigo-500 transition-colors">
                Upgrade
              </button>
            </div>

            {/* User info */}
            {user && (
              <div className="flex items-center gap-3 px-4 py-3 mb-1">
                <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xs shrink-0">
                  {user.username?.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{user.username}</p>
                  <p className="text-xs text-gray-500 truncate">{user.email}</p>
                </div>
              </div>
            )}

            <a href="#" className="flex items-center gap-4 px-4 py-3 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-all font-medium">
              <HelpCircle className="w-5 h-5" />
              Help &amp; Info
            </a>
            <button
              id="sidebar-logout"
              onClick={handleLogout}
              className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-all font-medium"
            >
              <LogOut className="w-5 h-5" />
              Log out
            </button>
          </div>
        </div>

        {/* ── Main Content ── */}
        <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-900 relative">
          <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-gradient-to-bl from-indigo-50 to-transparent dark:from-indigo-900/10 pointer-events-none" />
          <Outlet />
        </div>

      </div>
    </div>
  );
}
