import React, { useState, useRef } from 'react';
import { UploadCloud, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import axios from 'axios';

export default function AddDocPage() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, uploading, success, error
  const [message, setMessage] = useState('');
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setStatus('idle');
      setMessage('');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFile(e.dataTransfer.files[0]);
      setStatus('idle');
      setMessage('');
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    
    setStatus('uploading');
    setMessage('');
    
    const formData = new FormData();
    formData.append('file', file);
    
    // We can also ask the user to specify a project name if needed, but for now we'll use a default
    formData.append('project_name', 'MergeMind');

    try {
      const response = await axios.post('http://localhost:8000/api/brain/upload-pdf', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      setStatus('success');
      setMessage('PDF successfully processed and added to the knowledge graph!');
    } catch (err) {
      console.error(err);
      setStatus('error');
      setMessage(err.response?.data?.detail || 'Failed to upload and process the PDF.');
    }
  };

  return (
    <div className="p-8 lg:p-12">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Add Documentation</h1>
      <p className="text-gray-500 dark:text-gray-400 mb-12">Upload a PDF to enrich the MergeMind knowledge graph.</p>
      
      <div 
        className={`border-2 border-dashed rounded-3xl p-12 flex flex-col items-center justify-center text-center max-w-3xl transition-colors
          ${status === 'uploading' ? 'border-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/10' : 
            status === 'success' ? 'border-green-400 bg-green-50/50 dark:bg-green-900/10' : 
            status === 'error' ? 'border-red-400 bg-red-50/50 dark:bg-red-900/10' : 
            'border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/20 hover:border-indigo-400 dark:hover:border-indigo-500'}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {status === 'success' ? (
          <div className="w-20 h-20 bg-green-100 dark:bg-green-900/50 rounded-full flex items-center justify-center mb-6">
            <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
          </div>
        ) : status === 'error' ? (
          <div className="w-20 h-20 bg-red-100 dark:bg-red-900/50 rounded-full flex items-center justify-center mb-6">
            <AlertCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
          </div>
        ) : status === 'uploading' ? (
          <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/50 rounded-full flex items-center justify-center mb-6">
            <Loader2 className="w-10 h-10 text-indigo-600 dark:text-indigo-400 animate-spin" />
          </div>
        ) : (
          <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/50 rounded-full flex items-center justify-center mb-6">
            <UploadCloud className="w-10 h-10 text-indigo-600 dark:text-indigo-400" />
          </div>
        )}

        {status === 'success' || status === 'error' ? (
          <>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              {status === 'success' ? 'Upload Complete' : 'Upload Failed'}
            </h2>
            <p className={`mb-8 max-w-sm ${status === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {message}
            </p>
            <button 
              onClick={() => { setFile(null); setStatus('idle'); setMessage(''); }}
              className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-medium rounded-xl px-8 py-3 transition-all"
            >
              Upload Another
            </button>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              {file ? file.name : "Click to upload or drag and drop"}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-8 max-w-sm">
              {file ? `${(file.size / (1024 * 1024)).toFixed(2)} MB` : "PDF documents up to 50MB are supported. The contents will be processed and added to your project's brain."}
            </p>
            <input 
              type="file" 
              accept=".pdf" 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileChange}
            />
            {file ? (
              <button 
                onClick={handleUpload}
                disabled={status === 'uploading'}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-xl px-8 py-4 transition-all shadow-lg hover:shadow-indigo-500/30 flex items-center gap-2"
              >
                {status === 'uploading' ? 'Processing...' : 'Process PDF'}
              </button>
            ) : (
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl px-8 py-4 transition-all shadow-lg hover:shadow-indigo-500/30"
              >
                Select PDF File
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
