// src/components/TagCard.tsx
import React from 'react'
import { Link } from 'react-router-dom'
import { Tag } from '../types'

export default function TagCard({ tag }: { tag: Tag }) {
    const countMedia = tag.media.length
    const countPeople = tag.persons.length

    // take up to 4 thumbnails from tag.media
    const thumbs = tag.media.slice(0, 4).map(m => (
        <img
            key={m.id}
            src={`/thumbnails/${m.id}.jpg`}
            alt=""
            className="w-12 h-12 object-cover rounded"
        />
    ))

    return (
        <Link
            to={`/tags/${tag.id}`}
            className="
        block bg-gray-800 p-4 rounded-lg shadow hover:shadow-lg transition
      "
        >
            <h2 className="font-semibold mb-1">{tag.name}</h2>
            <div className="flex items-center text-sm text-gray-400 mb-2">
                <span className="mr-2">🎬 {countMedia}</span>
                <span>👤 {countPeople}</span>
            </div>
            <div className="flex -space-x-1">
                {thumbs}
                {countMedia > 4 && (
                    <div className="w-12 h-12 flex items-center justify-center bg-gray-700 rounded text-xs">
                        +{countMedia - 4}
                    </div>
                )}
            </div>
        </Link>
    )
}
