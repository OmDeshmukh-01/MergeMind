import tempfile
import os
import uuid
from fastapi import UploadFile
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter, MarkdownHeaderTextSplitter
from sentence_transformers import SentenceTransformer
from app.graph.neo4j_client import neo4j_client

embedding_model = None

def get_embedding_model():
    global embedding_model
    if embedding_model is None:
        embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
    return embedding_model

async def process_pdf(file: UploadFile, project_name: str):
    # Save uploaded file to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # 1. Load PDF
        loader = PyPDFLoader(tmp_path)
        documents = loader.load()

        # 2. Chunk Text
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=150,
            length_function=len
        )
        chunks = text_splitter.split_documents(documents)

        # 3. Embed & Store in Neo4j
        model = get_embedding_model()
        doc_id = str(uuid.uuid4())
        filename = file.filename

        with neo4j_client.get_session() as session:
            # Create Document Node
            session.run("""
                MERGE (p:Project {name: $project_name})
                CREATE (d:Document {
                    id: $doc_id,
                    filename: $filename,
                    project_name: $project_name,
                    created_at: timestamp()
                })
                MERGE (d)-[:BELONGS_TO]->(p)
            """, project_name=project_name, doc_id=doc_id, filename=filename)

            # Insert chunks
            for i, chunk in enumerate(chunks):
                chunk_text = chunk.page_content
                embedding = model.encode(chunk_text).tolist()
                chunk_id = f"{doc_id}_chunk_{i}"

                session.run("""
                    MATCH (d:Document {id: $doc_id})
                    CREATE (c:DocumentChunk {
                        id: $chunk_id,
                        text: $text,
                        page_number: $page_number,
                        chunk_index: $chunk_index,
                        embedding: $embedding
                    })
                    CREATE (d)-[:HAS_CHUNK]->(c)
                """, 
                doc_id=doc_id,
                chunk_id=chunk_id, 
                text=chunk_text,
                page_number=chunk.metadata.get('page', 0),
                chunk_index=i,
                embedding=embedding)
                
            try:
                session.run("""
                    CREATE VECTOR INDEX document_chunk_index IF NOT EXISTS
                    FOR (c:DocumentChunk) ON (c.embedding)
                    OPTIONS {indexConfig: {
                        `vector.dimensions`: 384,
                        `vector.similarity_function`: 'cosine'
                    }}
                """)
            except Exception as e:
                print(f"Warning: Could not create vector index: {e}")

        return {"status": "success", "chunks_processed": len(chunks), "doc_id": doc_id}
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


async def process_markdown(file: UploadFile, project_name: str):
    """Process an uploaded .md file — chunk by headings, embed, and store in Neo4j."""
    content = await file.read()
    md_text = content.decode("utf-8", errors="replace")

    # 1. Split on Markdown headings first, then fall back to size-based splitting
    headers_to_split_on = [
        ("#",  "Header1"),
        ("##", "Header2"),
        ("###","Header3"),
    ]
    md_splitter = MarkdownHeaderTextSplitter(
        headers_to_split_on=headers_to_split_on,
        strip_headers=False
    )
    md_docs = md_splitter.split_text(md_text)

    # Secondary split in case any section is still too long
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=150,
        length_function=len
    )
    chunks = text_splitter.split_documents(md_docs)

    # 2. Embed & Store in Neo4j
    model = get_embedding_model()
    doc_id = str(uuid.uuid4())
    filename = file.filename

    with neo4j_client.get_session() as session:
        # Create Document Node
        session.run("""
            MERGE (p:Project {name: $project_name})
            CREATE (d:Document {
                id: $doc_id,
                filename: $filename,
                project_name: $project_name,
                doc_type: 'markdown',
                created_at: timestamp()
            })
            MERGE (d)-[:BELONGS_TO]->(p)
        """, project_name=project_name, doc_id=doc_id, filename=filename)

        # Insert chunks
        for i, chunk in enumerate(chunks):
            chunk_text = chunk.page_content
            embedding = model.encode(chunk_text).tolist()
            chunk_id = f"{doc_id}_chunk_{i}"
            # Capture heading metadata if present
            header = " > ".join(
                v for k, v in chunk.metadata.items() if k.startswith("Header")
            )

            session.run("""
                MATCH (d:Document {id: $doc_id})
                CREATE (c:DocumentChunk {
                    id: $chunk_id,
                    text: $text,
                    header: $header,
                    chunk_index: $chunk_index,
                    embedding: $embedding
                })
                CREATE (d)-[:HAS_CHUNK]->(c)
            """,
            doc_id=doc_id,
            chunk_id=chunk_id,
            text=chunk_text,
            header=header,
            chunk_index=i,
            embedding=embedding)

        try:
            session.run("""
                CREATE VECTOR INDEX document_chunk_index IF NOT EXISTS
                FOR (c:DocumentChunk) ON (c.embedding)
                OPTIONS {indexConfig: {
                    `vector.dimensions`: 384,
                    `vector.similarity_function`: 'cosine'
                }}
            """)
        except Exception as e:
            print(f"Warning: Could not create vector index: {e}")

    return {"status": "success", "chunks_processed": len(chunks), "doc_id": doc_id}
